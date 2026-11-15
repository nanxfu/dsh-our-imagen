"""鉴权。

无 token 401、allow_no_auth 放行、Bearer 比较。

拆分自 test/daemon-unit.py，运行：python test/remote/test_auth.py
"""

from __future__ import annotations

from support import AUTH_TOKEN, DaemonUnitTest, d, make_handler


class AuthTest(DaemonUnitTest):
    def test_missing_token_returns_401_by_default(self) -> None:
        handler, sent = make_handler("Bearer anything")
        self.assertFalse(handler._require_auth())
        self.assertEqual(sent[0][0], 401)
        self.assertEqual(sent[0][1]["error"]["code"], "unauthorized")

    def test_missing_token_allowed_with_allow_no_auth(self) -> None:
        d.CONFIG.allow_no_auth = True
        handler, sent = make_handler()
        self.assertTrue(handler._require_auth())
        self.assertEqual(sent, [])

    def test_correct_bearer_token_passes(self) -> None:
        d.CONFIG.auth_token = AUTH_TOKEN
        handler, sent = make_handler(f"Bearer {AUTH_TOKEN}")
        self.assertTrue(handler._require_auth())
        self.assertEqual(sent, [])

    def test_wrong_bearer_token_returns_401(self) -> None:
        d.CONFIG.auth_token = AUTH_TOKEN
        for header in ("Bearer wrong", AUTH_TOKEN, "Basic abc"):
            handler, sent = make_handler(header)
            self.assertFalse(handler._require_auth(), header)
            self.assertEqual(sent[0][1]["error"]["code"], "unauthorized")

    def test_auth_missing_matrix(self) -> None:
        self.assertTrue(d.auth_missing())
        d.CONFIG.allow_no_auth = True
        self.assertFalse(d.auth_missing())
        d.CONFIG.allow_no_auth = False
        d.CONFIG.auth_token = AUTH_TOKEN
        self.assertFalse(d.auth_missing())


if __name__ == "__main__":
    import unittest

    unittest.main()
