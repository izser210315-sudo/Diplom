from django.contrib import admin as django_admin
from django.urls import include, path


urlpatterns = [
    path("django-admin/", django_admin.site.urls),
    path("", include("core.urls")),
]

handler404 = "core.views.page_not_found"
