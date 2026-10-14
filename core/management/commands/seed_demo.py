import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.models import UserProfile


class Command(BaseCommand):
    help = "Создаёт демонстрационные аккаунты FormSpace"

    def handle(self, *args, **options):
        User = get_user_model()
        accounts = [
            {
                "email": "admin@formspace.local",
                "name": "Администратор",
                "password": os.environ.get("ADMIN_PASSWORD", "Admin123!"),
                "is_staff": True,
                "is_superuser": True,
                "bio": "Администратор платформы",
            },
            {
                "email": "user@formspace.local",
                "name": "Алексей Морозов",
                "password": os.environ.get("DEMO_PASSWORD", "User123!"),
                "is_staff": False,
                "is_superuser": False,
                "bio": "Начинающий 3D-художник",
            },
        ]
        for account in accounts:
            user, created = User.objects.get_or_create(
                username=account["email"],
                defaults={
                    "email": account["email"],
                    "first_name": account["name"],
                    "is_staff": account["is_staff"],
                    "is_superuser": account["is_superuser"],
                },
            )
            if created:
                user.set_password(account["password"])
                user.save()
            profile, _ = UserProfile.objects.get_or_create(user=user)
            if created:
                profile.bio = account["bio"]
                profile.save(update_fields=["bio"])
            self.stdout.write(self.style.SUCCESS(f"Готово: {account['email']}"))
