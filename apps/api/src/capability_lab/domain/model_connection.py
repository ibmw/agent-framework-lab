"""Where the lab may be pointed, and how one endpoint is spelled once (ADR 0052).

A model connection is not a definition. It has no draft, no published version, no canonical
document and no fingerprint, and it must never enter one: a snapshot resolved last week
describes the same starting state today whatever the lab is now pointed at. What lives here
is the one invariant the connection carries — that its base URL is a value the lab is willing
to store, display and pin a run to.

The validation table is ADR 0052's, and each line of it is load-bearing rather than tidy:

- **`http` or `https` only.** A base URL is handed to an HTTP client; a `file:` or `ftp:`
  spelling is not an endpoint this lab can speak the OpenAI protocol to.
- **No userinfo.** ADR 0044 refused to serve the OTLP endpoint because "a collector URL is a
  place a deployment can put a token, and a route that serves it is a route that serves that
  token the day somebody does". That reasoning is answered here by removing the place the
  token could sit rather than by hiding the value, which is what makes the stored URL safe to
  serve back and to write onto a run.
- **No query and no fragment.** Same argument, one step further: both are places a key can be
  parked, and neither means anything to a base URL an SDK appends a path to.
- **`http` only for a loopback or private host.** `http://localhost:11434/v1` is the whole
  point of this feature — a local model with no credential leaving the machine — and a
  plaintext key crossing the internet is not. "Private" here is narrower than the standard
  library's, which means *IANA special-purpose*: link-local and the `2001::/23` protocol
  assignments are subtracted, because each is special-purpose and still carries a packet off
  the machine in the clear. `_is_local` classifies all 24 entries of CPython's table to say
  why those two and no others. For a *name* rather than an address the rule is narrower still
  — `localhost` only. All three readings are narrower than ADR 0052's sentence sounds, and its
  amendment of 2026-09-22 records them rather than leaving the code to be the only statement.
- **One spelling.** A run pins the endpoint it reached and refuses an advance against another
  (ADR 0052), so `HTTPS://Api.Example.com:443/v1/` and `https://api.example.com/v1` have to
  compare equal or that refusal would fire on a lab nobody repointed. Every IP literal is
  stored in one canonical form for that reason; how far the *path* is folded is a separate
  decision, taken at the line that does it.

No refusal here ever echoes the value it refused. A URL carrying userinfo carries a password,
and a message that quoted it back would put a credential into an error payload, a log line and
a browser's history — which is exactly what the rule above exists to prevent.
"""

from __future__ import annotations

from ipaddress import IPv6Address, IPv6Network, ip_address
from urllib.parse import SplitResult, urlsplit, urlunsplit

from capability_lab.domain.entities import DomainError

__all__ = [
    "MAX_BASE_URL_LENGTH",
    "ModelConnectionConfigurationError",
    "normalize_base_url",
]

MAX_BASE_URL_LENGTH = 2048
"""What the column holds. Long enough for any endpoint, short enough not to be a payload."""

_DEFAULT_PORTS = {"http": 80, "https": 443}
_PLAINTEXT_SCHEME = "http"

_PROTOCOL_ASSIGNMENTS = IPv6Network("2001::/23")
"""IETF protocol assignments, which `_is_local` subtracts whole.

CPython counts the entire range as private while `address.teredo` matches only the `/32` inside
it, which is how seven blocks IANA marks Globally Reachable stayed admitted over `http` — plus
teredo itself, whose packets leave over a tunnel. `_is_local` lists them."""


class ModelConnectionConfigurationError(DomainError):
    """Raised when a connection's content violates a structural invariant.

    Carries the field it is about, so the route can refuse with 422 naming it rather than
    leaving a reader to find the offending input in a sentence.
    """

    def __init__(self, message: str, *, field: str = "base_url") -> None:
        super().__init__(message)
        self.field = field


def normalize_base_url(value: str) -> str:
    """Validate one endpoint and return its single spelling.

    Raises `ModelConnectionConfigurationError` without quoting `value`, for the reason in this
    module's docstring.
    """
    candidate = value.strip()
    if not candidate:
        raise ModelConnectionConfigurationError("base_url must not be empty")
    if len(candidate) > MAX_BASE_URL_LENGTH:
        raise ModelConnectionConfigurationError(
            f"base_url must be at most {MAX_BASE_URL_LENGTH} characters"
        )

    parts = _split(candidate)
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS:
        raise ModelConnectionConfigurationError("base_url must use the http or https scheme")
    if parts.username is not None or parts.password is not None:
        raise ModelConnectionConfigurationError(
            "base_url must not carry a username or password; a credential belongs in the "
            "API key field, which is stored encrypted and never served back"
        )
    if parts.query:
        raise ModelConnectionConfigurationError("base_url must not carry a query string")
    if parts.fragment:
        raise ModelConnectionConfigurationError("base_url must not carry a fragment")

    host = _require_host(parts.hostname)
    port = _require_port(parts)
    if scheme == _PLAINTEXT_SCHEME and not _is_local(host):
        raise ModelConnectionConfigurationError(
            "base_url may only use http for a loopback or private host, so that a key is "
            "never sent to a public endpoint in plaintext; use https instead"
        )

    # An IPv6 literal is parsed without its brackets and has to be written back inside them,
    # or the one spelling this function promises would not parse.
    written = f"[{host}]" if ":" in host else host
    authority = written if port is None or port == _DEFAULT_PORTS[scheme] else f"{written}:{port}"
    # The path is folded at its trailing slashes and nowhere else, which is a decision rather
    # than the limit of the effort. An inner `//` and a percent-encoded `/%76%31` are different
    # request targets: an origin server is entitled to answer them differently, and a lab that
    # rewrote what the operator typed into something the server had not been asked for would be
    # storing an endpoint nobody tested. What the gap costs is paid by unit B's pin refusal,
    # which names both endpoints — a legible refusal on a retyped spelling, rather than a silent
    # rewrite. A trailing slash is folded because it is the one case where every server agrees
    # and every operator's paste disagrees.
    return urlunsplit((scheme, authority, parts.path.rstrip("/"), "", ""))


def _require_host(hostname: str | None) -> str:
    """The one spelling of this host, for storing and for classifying alike.

    Folded here rather than at the classification below, because the two callers must not be
    able to disagree. An address admitted as local but *stored* in a second spelling would
    satisfy this module and then break the next one: a run is pinned to the stored value, and
    unit B refuses an advance that would reach a different endpoint, so two spellings of one
    address would fire that refusal on a lab nobody had repointed (ADR 0052).

    An IPv4-mapped address is the case that matters. RFC 4291 defines `::ffff:10.0.0.5` as a
    representation *of* `10.0.0.5` — one address, two spellings — and the standard library
    agrees about the address while disagreeing about its properties:
    `ip_address("::ffff:169.254.169.254").is_link_local` is `False` where the plain spelling's
    is `True`, so the link-local exclusion below was bypassed by rewriting the address rather
    than by defeating the rule.

    Only `ipv4_mapped` is folded, and deliberately not the other embeddings. `2002::/16` (6to4),
    `2001::/32` (teredo) and `64:ff9b::/96` (NAT64) also carry an IPv4 address inside them, and
    folding those would be a *bug* rather than a wider fix: a packet to a 6to4 address does not
    go to the address it embeds, so rewriting it would make this module claim an endpoint that
    is not the one the operator named.

    Every other IP literal is written in the standard library's canonical form, which is the
    same argument one step wider. RFC 4291 §2.2 makes `::1`, `0:0:0:0:0:0:0:1` and the fully
    expanded spelling one address written three ways, and storing them apart would leave unit
    B's pin refusal firing on a retyped spelling exactly as the mapped form did. Folding the
    mapped form is *not* subsumed by canonicalising and has to happen first:
    `str(ip_address("::ffff:10.0.0.5"))` is `::ffff:a00:5`, a third spelling rather than the
    IPv4 one.
    """
    if not hostname:
        raise ModelConnectionConfigurationError("base_url must name a host")
    # `urlsplit` already lowercases the host it parses. The trailing dot of a fully qualified
    # name is removed here so that one endpoint is not two rows. It is *named* for that case
    # and load-bearing there — `https://api.example.com./v1` has to fold — but it fires for a
    # dotted IPv4 literal too, and `http://127.0.0.1./v1` stores as `http://127.0.0.1/v1`,
    # which is the same folding and equally wanted. What it never sees is a bracketed host:
    # `_split` has already refused one that is not an IPv6 literal, and a literal cannot carry
    # a trailing dot.
    host = hostname.rstrip(".")
    if not host:
        raise ModelConnectionConfigurationError("base_url must name a host")
    return _canonical_address(host)


def _canonical_address(host: str) -> str:
    """One spelling of an IP literal; a name is returned untouched, never resolved."""
    try:
        address = ip_address(host)
    except ValueError:
        return host
    if isinstance(address, IPv6Address) and address.ipv4_mapped is not None:
        return str(address.ipv4_mapped)
    return str(address)


def _split(candidate: str) -> SplitResult:
    """Parse the URL, turning the library's own refusal into this module's.

    The same rule `_require_port` below is written for, and it has to be here too because the
    refusal arrives from a different line for a different reason. `urlsplit` validates a
    *bracketed* host eagerly — `_check_bracketed_host` runs `ip_address` on it — and raises a
    bare `ValueError` for anything in brackets that is not an IPv6 literal — including a
    bracketed *IPv4* one, which it refuses with "An IPv4 address cannot be in brackets", so the
    rule the message states is IPv6 rather than IP. `http://[localhost]/v1` is an ordinary
    operator typo, and uncaught it left the route answering 500 for a mistyped endpoint rather
    than 422 naming the field.
    """
    try:
        return urlsplit(candidate)
    except ValueError as error:
        raise ModelConnectionConfigurationError(
            "base_url must name a host, and square brackets may only hold an IPv6 address"
        ) from error


def _require_port(parts: SplitResult) -> int | None:
    """Read the port, turning the library's own refusal into this module's.

    `urlsplit` parses lazily: a port that is not a number raises only when it is read, and it
    raises `ValueError` from inside the standard library. Caught here so that a mistyped
    endpoint is refused by the same rule as every other malformed one rather than reaching the
    route as an unhandled error.
    """
    try:
        return parts.port
    except ValueError as error:
        raise ModelConnectionConfigurationError("base_url must carry a valid port") from error


def _is_local(host: str) -> bool:
    """Whether a plaintext key sent here would stay on the operator's own network.

    Loopback and private, which is what ADR 0052 writes — with two subtractions, and the
    subtractions are the whole substance of this function.

    **`is_private` does not mean "on your network".** It means "in IANA's special-purpose
    registry", which is a wider and differently-shaped set. CPython's table holds 24 entries,
    14 for IPv4 and 10 for IPv6, and every one of them falls into exactly one of four groups.

    *Genuinely local, and the reason this rule exists* (6): `10.0.0.0/8`, `172.16.0.0/12`,
    `192.168.0.0/16`, `127.0.0.0/8`, `::1/128`, `fc00::/7`.

    *Already rewritten before this function is reached* (1): `::ffff:0:0/96`, which
    `_require_host` writes as the IPv4 address it represents, so it arrives here as IPv4.

    *Special-purpose but carrying a packet nowhere* (12): `0.0.0.0/8`, `240.0.0.0/4`,
    `255.255.255.255/32`, `192.0.0.0/29` (IETF protocol assignments, IPv4), `192.0.0.170/31`
    (NAT64/DNS64 discovery), `192.0.2.0/24`, `198.51.100.0/24` and `203.0.113.0/24` (the three
    TEST-NETs), `198.18.0.0/15` (benchmarking), `::/128`, `100::/64` (discard-only) and
    `2001:db8::/32` (documentation). None is globally reachable, so none can carry a key off
    the machine, and none is subtracted.

    *Special-purpose **and** routed off the machine* (2 entries, subtracted):

    - **Link-local** — `169.254.0.0/16` and `fe80::/10`. `169.254.169.254` is the cloud
      instance-metadata address, `POST …/test` makes a server-side call to whatever it is
      handed from a route nobody authenticates, and nothing is ever hosted on a link-local
      address on purpose. It has to be subtracted explicitly rather than by dropping a term:
      `ipaddress` folds both ranges into `is_private`, so removing an `is_link_local` clause
      changes nothing at all.
    - **`2001::/23`, the IETF protocol assignments.** The whole block, not teredo alone. IANA
      lists seven blocks inside it as Globally Reachable — PCP, TURN and DNS-SD SRP anycast
      (`2001:1::1/128`, `::2`, `::3`), AMT (`2001:3::/32`), AS112-v6 (`2001:4:112::/48`),
      ORCHIDv2 (`2001:20::/28`) and DET (`2001:30::/28`) — alongside teredo (`2001::/32`),
      whose packets are tunnelled over UDP to an ordinarily public IPv4 relay. Any of them
      would carry a typed key off the machine in the clear, which is the single outcome this
      `http` rule exists to prevent. CPython carries `2001::/23` as one entry and
      `address.teredo` matches only the `/32` inside it, so subtracting by that attribute left
      the other seven admitted. The two members of the block that are *not* globally reachable
      — `2001:2::/48` (benchmarking) and `2001:10::/28`, deprecated ORCHID — are refused along
      with them, which costs nothing anyone would type.

    6to4 and NAT64 are not subtracted because they are not admitted: neither is private.

    What this is *not* is an SSRF control. Pointing the lab at a URL is the feature, every
    loopback and private address is still reachable, and https to any host is untouched. The
    response body never comes back, so what remains is an existence oracle, and it is the same
    oracle any operator has from a shell on the machine running this process.

    An IP literal is decided by the address itself, in the one spelling `_require_host` has
    already folded it to — this function must never be the only place a spelling is decided,
    or an address could classify one way and store another.

    A name is decided by `localhost` alone, because that is the only name whose meaning this
    lab knows without resolving it — and resolving one would make a stored value depend on the
    DNS of the moment it was saved, which is not a thing a run can be pinned to. That is
    narrower than ADR 0052's wording reads, and the amendment there records it:
    `http://ollama.internal/v1` and a Compose service name are refused, and their operator's
    path is https or an address.

    The name branch is also the one place this function's promise rests on something outside
    the lab: `localhost` and `*.localhost` resolve to loopback because RFC 6761 reserves them
    to, not because anything here checked. A resolver configured to break that rule would make
    `*.localhost` a name like any other, which is the residual the address branch does not have.
    """
    try:
        address = ip_address(host)
    except ValueError:
        return host == "localhost" or host.endswith(".localhost")
    if address.is_loopback:
        return True
    if isinstance(address, IPv6Address) and address in _PROTOCOL_ASSIGNMENTS:
        return False
    return address.is_private and not address.is_link_local
