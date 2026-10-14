from django.contrib import admin

from .models import SupportMessage, UserProfile, Visit


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "theme", "accent", "density")
    search_fields = ("user__username", "user__email")


@admin.register(SupportMessage)
class SupportMessageAdmin(admin.ModelAdmin):
    list_display = ("user", "sender_role", "created_at", "read_at")
    list_filter = ("sender_role", "read_at")
    search_fields = ("user__email", "body")


@admin.register(Visit)
class VisitAdmin(admin.ModelAdmin):
    list_display = ("pathname", "user", "visited_at")
    list_filter = ("pathname",)
    readonly_fields = ("visitor_hash", "visited_at")
