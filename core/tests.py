import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase

from .models import SupportMessage, UserProfile


class FormSpaceFlowTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="user@example.test",
            email="user@example.test",
            password="StrongPass123!",
            first_name="Тестовый пользователь",
        )
        self.other_user = User.objects.create_user(
            username="other@example.test",
            email="other@example.test",
            password="OtherPass123!",
            first_name="Другой пользователь",
        )
        self.admin = User.objects.create_superuser(
            username="admin@example.test",
            email="admin@example.test",
            password="AdminPass123!",
            first_name="Администратор",
        )

    @staticmethod
    def _json(client, method, path, payload=None, **extra):
        return getattr(client, method)(
            path,
            data=json.dumps(payload if payload is not None else {}),
            content_type="application/json",
            **extra,
        )

    def test_public_pages_and_access_redirects(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Создавай миры")
        self.assertEqual(self.client.get("/cabinet").status_code, 302)
        self.assertEqual(self.client.get("/admin").status_code, 302)
        self.assertEqual(self.client.get("/missing-page").status_code, 404)

        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/cabinet").status_code, 200)
        self.assertRedirects(self.client.get("/admin"), "/cabinet")

        self.client.force_login(self.admin)
        self.assertRedirects(self.client.get("/cabinet"), "/admin")
        self.assertEqual(self.client.get("/admin").status_code, 200)

    def test_csrf_is_required_for_all_mutating_api_routes(self):
        client = Client(enforce_csrf_checks=True)
        login_payload = {"email": "user@example.test", "password": "StrongPass123!"}
        self.assertEqual(self._json(client, "post", "/api/login", login_payload).status_code, 403)
        self.assertEqual(self._json(client, "post", "/api/visit", {"pathname": "/"}).status_code, 403)

        session = client.get("/api/me")
        csrf_token = session.json()["csrfToken"]
        response = self._json(
            client,
            "post",
            "/api/login",
            login_payload,
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(response.status_code, 200)

    def test_registration_validates_input_and_creates_profile(self):
        self.assertEqual(self._json(self.client, "post", "/api/register", []).status_code, 400)
        self.assertEqual(self._json(self.client, "post", "/api/register", {
            "name": "Новый пользователь", "email": "bad-email", "password": "StrongPass123!",
        }).status_code, 400)
        self.assertEqual(self._json(self.client, "post", "/api/register", {
            "name": "Новый пользователь", "email": "new@example.test", "password": "password",
        }).status_code, 400)

        response = self._json(self.client, "post", "/api/register", {
            "name": "Новый пользователь",
            "email": "new@example.test",
            "password": "NewStrongPass123!",
        })
        self.assertEqual(response.status_code, 201)
        created = get_user_model().objects.get(username="new@example.test")
        self.assertTrue(UserProfile.objects.filter(user=created).exists())

    def test_user_profile_and_chat_flow(self):
        response = self._json(self.client, "post", "/api/login", {
            "email": "user@example.test", "password": "StrongPass123!",
        })
        self.assertEqual(response.status_code, 200)

        response = self._json(self.client, "patch", "/api/profile", {
            "name": "Новый профиль",
            "bio": "Работаю с 3D",
            "theme": "light",
            "accent": "cyan",
            "density": "compact",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["theme"], "light")

        invalid = self._json(self.client, "patch", "/api/profile", {
            "name": "Новый профиль", "theme": "unknown",
        })
        self.assertEqual(invalid.status_code, 400)

        response = self._json(self.client, "post", "/api/messages", {
            "message": "Нужна обратная связь",
            "userId": self.other_user.id,
        })
        self.assertEqual(response.status_code, 201)
        self.assertTrue(SupportMessage.objects.filter(user=self.user).exists())
        self.assertFalse(SupportMessage.objects.filter(user=self.other_user).exists())

    def test_admin_permissions_reply_and_read_state(self):
        message = SupportMessage.objects.create(
            user=self.user,
            sender_role="user",
            body="Вопрос администратору",
        )
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/api/admin/users").status_code, 403)
        self.assertEqual(self.client.get("/api/admin/analytics").status_code, 403)

        self.client.force_login(self.admin)
        self.assertEqual(self.client.get("/api/messages?userId=not-a-number").status_code, 404)
        self.assertEqual(self._json(self.client, "post", "/api/messages", {
            "userId": {"invalid": True}, "message": "Ответ",
        }).status_code, 404)
        response = self.client.get(f"/api/messages?userId={self.user.id}")
        self.assertEqual(response.status_code, 200)
        message.refresh_from_db()
        self.assertIsNotNone(message.read_at)

        response = self._json(self.client, "post", "/api/messages", {
            "userId": self.user.id,
            "message": "Ответ администратора",
        })
        self.assertEqual(response.status_code, 201)
        self.assertTrue(SupportMessage.objects.filter(
            user=self.user,
            sender_role="admin",
            body="Ответ администратора",
        ).exists())

    def test_visit_tracking_and_admin_analytics(self):
        first = Client()
        second = Client()
        for client, pathname in ((first, "/"), (first, "/cabinet"), (second, "/")):
            token = client.get("/api/me").json()["csrfToken"]
            response = self._json(
                client,
                "post",
                "/api/visit",
                {"pathname": pathname, "referrer": ""},
                HTTP_X_CSRFTOKEN=token,
            )
            self.assertEqual(response.status_code, 201)

        self.client.force_login(self.admin)
        analytics = self.client.get("/api/admin/analytics")
        self.assertEqual(analytics.status_code, 200)
        self.assertEqual(analytics.json()["totals"]["views"], 3)
        self.assertEqual(analytics.json()["totals"]["visitors"], 2)

        users = self.client.get("/api/admin/users")
        self.assertEqual(users.status_code, 200)
        self.assertEqual(len(users.json()["users"]), 3)

    def test_api_rejects_wrong_methods_and_anonymous_access(self):
        self.assertEqual(self.client.get("/api/login").status_code, 405)
        self.assertEqual(self.client.get("/api/profile").status_code, 405)
        self.assertEqual(self.client.get("/api/messages").status_code, 401)
        self.assertEqual(self._json(self.client, "post", "/api/logout").status_code, 401)
