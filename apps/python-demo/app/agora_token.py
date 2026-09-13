"""
Agora AccessToken2 (v007) builder — a Python port of `agora-token`'s
RtcTokenBuilder2 / AccessToken2 (the same library `apps/orchestrator` uses).

There is no official Agora token package for Python that builds the current
AccessToken2 format, so this ports the algorithm directly from
`agora-token`'s JS source: a signed, zlib-compressed, base64 payload —
version prefix + HMAC-SHA256 signature + (appId, issueTs, expire, salt,
services). Each service (RTC, RTM) carries its own privilege-expiry map.

Byte format notes (matched field-for-field against the JS source):
  - All integers are little-endian.
  - Strings/bytes are length-prefixed with a uint16.
  - A privilege map is uint16 count, then (uint16 key, uint32 value) pairs,
    sorted by key — JS object property enumeration order sorts small
    integer-like keys ascending regardless of insertion order, so this must
    match or the signature won't verify server-side.
"""

from __future__ import annotations

import hashlib
import hmac
import random
import struct
import time
import zlib
from base64 import b64encode
from dataclasses import dataclass, field

VERSION = "007"

ROLE_PUBLISHER = 1
ROLE_SUBSCRIBER = 2

_RTC_SERVICE_TYPE = 1
_RTM_SERVICE_TYPE = 2

_RTC_PRIVILEGE_JOIN_CHANNEL = 1
_RTC_PRIVILEGE_PUBLISH_AUDIO = 2
_RTC_PRIVILEGE_PUBLISH_VIDEO = 3
_RTC_PRIVILEGE_PUBLISH_DATA_STREAM = 4
_RTM_PRIVILEGE_LOGIN = 1


class _ByteBuf:
    """Little-endian byte packer matching agora-token's `ByteBuf`."""

    def __init__(self) -> None:
        self._buf = bytearray()

    def put_uint16(self, value: int) -> "_ByteBuf":
        self._buf += struct.pack("<H", value & 0xFFFF)
        return self

    def put_uint32(self, value: int) -> "_ByteBuf":
        self._buf += struct.pack("<I", value & 0xFFFFFFFF)
        return self

    def put_bytes(self, data: bytes) -> "_ByteBuf":
        self.put_uint16(len(data))
        self._buf += data
        return self

    def put_string(self, value: str) -> "_ByteBuf":
        return self.put_bytes(value.encode("utf-8"))

    def put_privilege_map(self, privileges: dict[int, int]) -> "_ByteBuf":
        self.put_uint16(len(privileges))
        for key in sorted(privileges):
            self.put_uint16(key)
            self.put_uint32(privileges[key])
        return self

    def pack(self) -> bytes:
        return bytes(self._buf)


@dataclass
class _ServiceRtc:
    channel_name: str
    uid: str
    privileges: dict[int, int] = field(default_factory=dict)

    def add_privilege(self, privilege: int, expire: int) -> None:
        self.privileges[privilege] = expire

    def pack(self) -> bytes:
        head = _ByteBuf().put_uint16(_RTC_SERVICE_TYPE).put_privilege_map(self.privileges)
        body = _ByteBuf().put_string(self.channel_name).put_string(self.uid)
        return head.pack() + body.pack()


@dataclass
class _ServiceRtm:
    user_id: str
    privileges: dict[int, int] = field(default_factory=dict)

    def add_privilege(self, privilege: int, expire: int) -> None:
        self.privileges[privilege] = expire

    def pack(self) -> bytes:
        head = _ByteBuf().put_uint16(_RTM_SERVICE_TYPE).put_privilege_map(self.privileges)
        body = _ByteBuf().put_string(self.user_id)
        return head.pack() + body.pack()


class _AccessToken2:
    def __init__(self, app_id: str, app_certificate: str, expire: int) -> None:
        self.app_id = app_id
        self.app_certificate = app_certificate.encode("utf-8")
        self.issue_ts = int(time.time())
        self.expire = expire
        self.salt = random.randint(1, 99_999_999)
        self._services: dict[int, "_ServiceRtc | _ServiceRtm"] = {}

    def add_service(self, service_type: int, service: "_ServiceRtc | _ServiceRtm") -> None:
        self._services[service_type] = service

    def _signing_key(self) -> bytes:
        step1 = hmac.new(
            _ByteBuf().put_uint32(self.issue_ts).pack(),
            self.app_certificate,
            hashlib.sha256,
        ).digest()
        return hmac.new(
            _ByteBuf().put_uint32(self.salt).pack(),
            step1,
            hashlib.sha256,
        ).digest()

    def build(self) -> str:
        header = (
            _ByteBuf()
            .put_string(self.app_id)
            .put_uint32(self.issue_ts)
            .put_uint32(self.expire)
            .put_uint32(self.salt)
            .put_uint16(len(self._services))
            .pack()
        )
        signing_info = header
        for service_type in sorted(self._services):
            signing_info += self._services[service_type].pack()

        signature = hmac.new(self._signing_key(), signing_info, hashlib.sha256).digest()
        content = _ByteBuf().put_bytes(signature).pack() + signing_info
        compressed = zlib.compress(content)
        return VERSION + b64encode(compressed).decode("ascii")


def _rtc_service(channel_name: str, account: str, role: int, privilege_expire: int) -> _ServiceRtc:
    service = _ServiceRtc(channel_name=channel_name, uid=account)
    service.add_privilege(_RTC_PRIVILEGE_JOIN_CHANNEL, privilege_expire)
    if role == ROLE_PUBLISHER:
        service.add_privilege(_RTC_PRIVILEGE_PUBLISH_AUDIO, privilege_expire)
        service.add_privilege(_RTC_PRIVILEGE_PUBLISH_VIDEO, privilege_expire)
        service.add_privilege(_RTC_PRIVILEGE_PUBLISH_DATA_STREAM, privilege_expire)
    return service


def build_rtc_token(
    app_id: str,
    app_certificate: str,
    channel_name: str,
    account: str,
    role: int,
    token_expire_seconds: int,
    privilege_expire_seconds: int | None = None,
) -> str:
    """RTC-only publisher/subscriber token — what the browser joins with."""
    privilege_expire = privilege_expire_seconds if privilege_expire_seconds is not None else token_expire_seconds
    token = _AccessToken2(app_id, app_certificate, token_expire_seconds)
    token.add_service(
        _RTC_SERVICE_TYPE,
        _rtc_service(channel_name, account, role, privilege_expire),
    )
    return token.build()


def build_rtc_rtm_token(
    app_id: str,
    app_certificate: str,
    channel_name: str,
    account: str,
    role: int,
    token_expire_seconds: int,
    privilege_expire_seconds: int | None = None,
) -> str:
    """
    Combined RTC + RTM token — what ConvoAI needs: RTC to join/publish audio
    as the agent, RTM to authenticate the `Authorization: agora token=...`
    header on the ConvoAI REST calls (and, if RTM is ever turned on, to carry
    transcripts/control messages).

    Matches agora-token's `buildTokenWithRtm`: the RTM login privilege uses
    `token_expire`, not `privilege_expire` — that's not a typo, it's what the
    JS source does.
    """
    privilege_expire = privilege_expire_seconds if privilege_expire_seconds is not None else token_expire_seconds
    token = _AccessToken2(app_id, app_certificate, token_expire_seconds)
    token.add_service(
        _RTC_SERVICE_TYPE,
        _rtc_service(channel_name, account, role, privilege_expire),
    )
    rtm_service = _ServiceRtm(user_id=account)
    rtm_service.add_privilege(_RTM_PRIVILEGE_LOGIN, token_expire_seconds)
    token.add_service(_RTM_SERVICE_TYPE, rtm_service)
    return token.build()
