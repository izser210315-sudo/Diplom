import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="UserProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("bio", models.CharField(blank=True, max_length=280)),
                ("theme", models.CharField(choices=[("dark", "Тёмная"), ("light", "Светлая")], default="dark", max_length=12)),
                ("accent", models.CharField(choices=[("violet", "Фиолетовый"), ("cyan", "Голубой"), ("amber", "Янтарный")], default="violet", max_length=12)),
                ("density", models.CharField(choices=[("comfortable", "Комфортная"), ("compact", "Компактная")], default="comfortable", max_length=16)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="profile", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="SupportMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("sender_role", models.CharField(choices=[("user", "Пользователь"), ("admin", "Администратор")], max_length=8)),
                ("body", models.TextField(max_length=2000)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="support_messages", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.CreateModel(
            name="Visit",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("visitor_hash", models.CharField(max_length=64)),
                ("pathname", models.CharField(max_length=200)),
                ("referrer", models.CharField(blank=True, max_length=300)),
                ("visited_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="visits", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddIndex(
            model_name="supportmessage",
            index=models.Index(fields=["user", "created_at"], name="msg_user_created_idx"),
        ),
        migrations.AddIndex(
            model_name="visit",
            index=models.Index(fields=["user"], name="visit_user_idx"),
        ),
    ]
