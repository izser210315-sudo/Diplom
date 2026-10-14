from django.conf import settings
from django.db import models


class UserProfile(models.Model):
    THEME_CHOICES = [("dark", "Тёмная"), ("light", "Светлая")]
    ACCENT_CHOICES = [("violet", "Фиолетовый"), ("cyan", "Голубой"), ("amber", "Янтарный")]
    DENSITY_CHOICES = [("comfortable", "Комфортная"), ("compact", "Компактная")]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    bio = models.CharField(max_length=280, blank=True)
    theme = models.CharField(max_length=12, choices=THEME_CHOICES, default="dark")
    accent = models.CharField(max_length=12, choices=ACCENT_CHOICES, default="violet")
    density = models.CharField(max_length=16, choices=DENSITY_CHOICES, default="comfortable")

    def __str__(self):
        return f"Профиль {self.user.email or self.user.username}"


class SupportMessage(models.Model):
    SENDER_CHOICES = [("user", "Пользователь"), ("admin", "Администратор")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="support_messages")
    sender_role = models.CharField(max_length=8, choices=SENDER_CHOICES)
    body = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["user", "created_at"], name="msg_user_created_idx")]

    def __str__(self):
        return f"{self.get_sender_role_display()}: {self.body[:40]}"


class Visit(models.Model):
    visitor_hash = models.CharField(max_length=64)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="visits")
    pathname = models.CharField(max_length=200)
    referrer = models.CharField(max_length=300, blank=True)
    visited_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [models.Index(fields=["user"], name="visit_user_idx")]

    def __str__(self):
        return f"{self.pathname} — {self.visited_at:%d.%m.%Y %H:%M}"
