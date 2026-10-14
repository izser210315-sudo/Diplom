from django.urls import path

from . import views


urlpatterns = [
    path("", views.index, name="home"),
    path("login", views.login_page, name="login"),
    path("cabinet", views.cabinet_page, name="cabinet"),
    path("admin", views.admin_page, name="admin_panel"),
    path("api/me", views.api_me, name="api_me"),
    path("api/register", views.api_register, name="api_register"),
    path("api/login", views.api_login, name="api_login"),
    path("api/logout", views.api_logout, name="api_logout"),
    path("api/profile", views.api_profile, name="api_profile"),
    path("api/messages", views.api_messages, name="api_messages"),
    path("api/visit", views.api_visit, name="api_visit"),
    path("api/admin/users", views.api_admin_users, name="api_admin_users"),
    path("api/admin/analytics", views.api_admin_analytics, name="api_admin_analytics"),
]
