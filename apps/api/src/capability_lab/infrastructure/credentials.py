"""Encrypting the one secret this lab stores rather than reads (ADR 0052).

What this buys, said plainly so that nobody has to infer it: a copy of `var/agent-lab.db`, a
backup, a file dropped into a bug report, a checkout shared between machines — none of them
carries a usable credential. What it does not buy: anything at all against someone who can run
this process or read its environment, which is the same person. Tenancy and authentication are
still deferred, so the connection is exactly as protected as the API is, which today means it
is protected by the network the API is bound to.

**That first claim is conditional, and the condition is the variable.** `AGENT_LAB_CREDENTIAL_KEY`
must hold key material — the output of `openssl rand -base64 32` or its equal. HKDF below is
extract-and-expand, which is the right construction over a high-entropy input and the wrong one
over a memorable phrase: it runs one hash per guess, so somebody holding the file and not the
environment can dictionary-attack a human-chosen value at enormous speed, and with no salt the
derived key is the same function of the same phrase on every installation in the world. Nothing
here enforces that, and a length check would be a smell test wearing the clothes of a guarantee
— it would refuse a perfectly good 22-character base64 of 16 random bytes and admit thirty-two
`a`s. So the condition is stated instead: in `.env.example`, in ADR 0052's qualification, and
here. If a later slice wants to accept a phrase an operator can remember, the shape is `Scrypt`
or `PBKDF2HMAC` with a per-installation salt carried in the envelope — both are in this same
dependency — and that is a change to the stored format, which makes it its own slice rather
than a line in this one.

There is no default encryption key. `AGENT_LAB_CREDENTIAL_KEY` unset means saving a key is
refused, by the cipher this module returns for that case, with a message that names the
variable — because the operator's next move is to set it, and an error that made them guess
which one would be a refusal that teaches nothing.

The stored form is `nonce || ciphertext`, base64url encoded. AES-GCM authenticates as well as
encrypts, and the associated data below binds a stored value to its purpose, so a ciphertext
moved here from somewhere else fails to open rather than decrypting into something.
"""

from __future__ import annotations

from base64 import urlsafe_b64decode, urlsafe_b64encode
from secrets import token_bytes

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from capability_lab.application.model_connections import (
    CredentialCipher,
    CredentialDecryptionError,
    CredentialEncryptionUnavailableError,
)
from capability_lab.infrastructure.config import Settings

__all__ = [
    "CREDENTIAL_KEY_VARIABLE",
    "AesGcmCredentialCipher",
    "UnconfiguredCredentialCipher",
    "create_credential_cipher",
]

CREDENTIAL_KEY_VARIABLE = "AGENT_LAB_CREDENTIAL_KEY"
"""Named once, so the refusal and the documentation cannot drift apart."""

_NONCE_BYTES = 12
_KEY_BYTES = 32
_PURPOSE = b"agent-lab.model-connection.key"


class AesGcmCredentialCipher:
    """AES-GCM under a key derived from the environment's own.

    The variable carries key material of the operator's own length and encoding rather than
    exactly 32 bytes, so it is run through HKDF to reach the width AES-GCM wants instead of
    being truncated or padded to it. HKDF is the correct construction for that — expanding
    high-entropy input into a key of a given size is what it is for — and it is emphatically
    not a password KDF; the module docstring above says what that costs and who is responsible
    for the difference.

    A fresh nonce per encryption means saving the same key twice produces two different stored
    values, which is the property that keeps a stored credential from being recognizable by
    comparison.
    """

    def __init__(self, secret: str) -> None:
        self._key = HKDF(
            algorithm=SHA256(),
            length=_KEY_BYTES,
            salt=None,
            info=_PURPOSE,
        ).derive(secret.encode("utf-8"))

    def encrypt(self, plaintext: str) -> str:
        nonce = token_bytes(_NONCE_BYTES)
        sealed = AESGCM(self._key).encrypt(nonce, plaintext.encode("utf-8"), _PURPOSE)
        return urlsafe_b64encode(nonce + sealed).decode("ascii")

    def decrypt(self, ciphertext: str) -> str:
        try:
            envelope = urlsafe_b64decode(ciphertext.encode("ascii"))
            opened = AESGCM(self._key).decrypt(
                envelope[:_NONCE_BYTES], envelope[_NONCE_BYTES:], _PURPOSE
            )
        except (InvalidTag, ValueError) as error:
            # Deliberately says nothing about what failed beyond the remedy. The bytes that
            # would not open are a credential, and an error that described them would be the
            # one place this module leaks the thing it exists to protect.
            raise CredentialDecryptionError(
                "the stored provider key cannot be read back with the current "
                f"{CREDENTIAL_KEY_VARIABLE}; save the key again to replace it"
            ) from error
        return opened.decode("utf-8")


class UnconfiguredCredentialCipher:
    """What a lab with no encryption key gets: a refusal that names the variable.

    A cipher rather than a `None` the callers test for, so there is exactly one place that
    decides what an unconfigured lab does and no path that could forget to ask.
    """

    def encrypt(self, plaintext: str) -> str:
        del plaintext
        raise CredentialEncryptionUnavailableError(
            f"set {CREDENTIAL_KEY_VARIABLE} before saving a provider key: this lab stores the "
            "key encrypted and ships no default encryption key, because a default one would "
            "be encryption theatre"
        )

    def decrypt(self, ciphertext: str) -> str:
        del ciphertext
        raise CredentialEncryptionUnavailableError(
            f"set {CREDENTIAL_KEY_VARIABLE} to read the provider key this lab has stored"
        )


def create_credential_cipher(settings: Settings) -> CredentialCipher:
    """Composition's one choice about credentials at rest.

    **An empty or blank value is unset**, and the distinction is not pedantic. Pydantic reads
    `AGENT_LAB_CREDENTIAL_KEY=` from the environment or a `.env` file as `SecretStr('')` rather
    than as `None`, so a test against `None` alone would hand an operator who uncommented the
    line without filling it in a working cipher keyed on `HKDF(b"")` — a fixed value anybody
    can derive, identical on every installation, wearing ciphertext that would make them
    believe the key was protected. That is not the weak key ADR 0052's amendment narrows to;
    it is the whole protection gone, and it is exactly the "encryption theatre" the decision
    refuses a default for. Whitespace is stripped for the same reason: a value that is only
    spaces was not configured by anybody on purpose.
    """
    configured = settings.credential_key
    if configured is None or not configured.get_secret_value().strip():
        return UnconfiguredCredentialCipher()
    return AesGcmCredentialCipher(configured.get_secret_value())
