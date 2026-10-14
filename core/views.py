import hashlib
import json
import secrets
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError
from django.db.models import Count, Q
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .models import SupportMessage, UserProfile, Visit


User = get_user_model()


def _json_body(request):
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("Некорректный JSON")
    if not isinstance(data, dict):
        raise ValueError("JSON должен быть объектом")
    return data


def _profile(user):
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return profile


def _safe_user(user):
    profile = _profile(user)
    return {
        "id": user.id,
        "name": user.first_name or user.get_full_name() or user.email or user.username,
        "email": user.email,
        "role": "admin" if user.is_staff else "user",
        "bio": profile.bio,
        "theme": profile.theme,
        "accent": profile.accent,
        "density": profile.density,
        "createdAt": user.date_joined.isoformat(),
    }


def _non_staff_user(user_id):
    try:
        normalized_id = int(user_id)
    except (TypeError, ValueError):
        return None
    if normalized_id < 1:
        return None
    return User.objects.filter(id=normalized_id, is_staff=False).first()


def _error(message, status=400):
    return JsonResponse({"error": message}, status=status)


def _api_user(request, admin=False):
    if not request.user.is_authenticated:
        return None, _error("Требуется вход", 401)
    if admin and not request.user.is_staff:
        return None, _error("Недостаточно прав", 403)
    return request.user, None


def index(request):
    return render(request, "core/index.html")


def login_page(request):
    if request.user.is_authenticated:
        return redirect("admin_panel" if request.user.is_staff else "cabinet")
    return render(request, "core/login.html")


@login_required
def cabinet_page(request):
    if request.user.is_staff:
        return redirect("admin_panel")
    return render(request, "core/dashboard.html")


@login_required
def admin_page(request):
    if not request.user.is_staff:
        return redirect("cabinet")
    return render(request, "core/admin.html")


def page_not_found(request, exception):
    return render(request, "404.html", status=404)


@require_GET
@ensure_csrf_cookie
def api_me(request):
    return JsonResponse({
        "user": _safe_user(request.user) if request.user.is_authenticated else None,
        "csrfToken": get_token(request),
    })


@require_POST
def api_register(request):
    try:
        data = _json_body(request)
    except ValueError as exc:
        return _error(str(exc))
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if not 2 <= len(name) <= 80:
        return _error("Имя должно содержать от 2 до 80 символов.")
    try:
        validate_email(email)
    except ValidationError:
        return _error("Введите корректный email.")
    if User.objects.filter(username__iexact=email).exists() or User.objects.filter(email__iexact=email).exists():
        return _error("Этот email уже зарегистрирован.", 409)
    candidate = User(username=email, email=email, first_name=name)
    try:
        validate_password(password, candidate)
    except ValidationError as exc:
        return _error(" ".join(exc.messages))
    try:
        user = User.objects.create_user(username=email, email=email, password=password, first_name=name)
    except IntegrityError:
        return _error("Этот email уже зарегистрирован.", 409)
    login(request, user)
    return JsonResponse({"ok": True}, status=201)


@require_POST
def api_login(request):
    try:
        data = _json_body(request)
    except ValueError as exc:
        return _error(str(exc))
    email = str(data.get("email", "")).strip().lower()
    user = authenticate(request, username=email, password=str(data.get("password", "")))
    if user is None:
        return _error("Неверный email или пароль.", 401)
    login(request, user)
    return JsonResponse({"user": _safe_user(user)})


@require_POST
def api_logout(request):
    user, error = _api_user(request)
    if error:
        return error
    logout(request)
    return JsonResponse({"ok": True})


@require_http_methods(["PATCH"])
def api_profile(request):
    user, error = _api_user(request)
    if error:
        return error
    try:
        data = _json_body(request)
    except ValueError as exc:
        return _error(str(exc))
    profile = _profile(user)
    name = str(data.get("name", user.first_name)).strip()[:80]
    if len(name) < 2:
        return _error("Имя слишком короткое.")
    theme = str(data.get("theme", profile.theme))
    accent = str(data.get("accent", profile.accent))
    density = str(data.get("density", profile.density))
    if theme not in dict(UserProfile.THEME_CHOICES):
        return _error("Неизвестная тема интерфейса.")
    if accent not in dict(UserProfile.ACCENT_CHOICES):
        return _error("Неизвестный акцентный цвет.")
    if density not in dict(UserProfile.DENSITY_CHOICES):
        return _error("Неизвестная плотность интерфейса.")
    user.first_name = name
    user.save(update_fields=["first_name"])
    profile.bio = str(data.get("bio", profile.bio)).strip()[:280]
    profile.theme = theme
    profile.accent = accent
    profile.density = density
    profile.save()
    return JsonResponse({"user": _safe_user(user)})


@require_http_methods(["GET", "POST"])
def api_messages(request):
    user, error = _api_user(request)
    if error:
        return error
    if request.method == "GET":
        requested_id = request.GET.get("userId")
        conversation_user = user
        if user.is_staff and requested_id:
            conversation_user = _non_staff_user(requested_id)
            if conversation_user is None:
                return _error("Пользователь не найден.", 404)
        messages = SupportMessage.objects.filter(user=conversation_user)
        now = timezone.now()
        if user.is_staff:
            messages.filter(sender_role="user", read_at__isnull=True).update(read_at=now)
        else:
            messages.filter(sender_role="admin", read_at__isnull=True).update(read_at=now)
        return JsonResponse({"messages": [{
            "id": item.id,
            "userId": item.user_id,
            "senderRole": item.sender_role,
            "body": item.body,
            "createdAt": item.created_at.isoformat(),
        } for item in messages]})

    try:
        data = _json_body(request)
    except ValueError as exc:
        return _error(str(exc))
    text = str(data.get("message", "")).strip()[:2000]
    if not text:
        return _error("Введите сообщение.")
    conversation_user = user
    sender_role = "user"
    if user.is_staff:
        conversation_user = _non_staff_user(data.get("userId"))
        sender_role = "admin"
        if conversation_user is None:
            return _error("Пользователь не найден.", 404)
    message = SupportMessage.objects.create(user=conversation_user, sender_role=sender_role, body=text)
    return JsonResponse({"id": message.id}, status=201)


@require_POST
def api_visit(request):
    try:
        data = _json_body(request)
    except ValueError as exc:
        return _error(str(exc))
    visitor = request.COOKIES.get("visitor") or secrets.token_urlsafe(18)
    pathname = str(data.get("pathname", "/")).strip()
    if not pathname.startswith("/"):
        pathname = "/"
    Visit.objects.create(
        visitor_hash=hashlib.sha256(visitor.encode("utf-8")).hexdigest(),
        user=request.user if request.user.is_authenticated else None,
        pathname=pathname[:200],
        referrer=str(data.get("referrer", ""))[:300],
    )
    response = JsonResponse({"ok": True}, status=201)
    response.set_cookie("visitor", visitor, max_age=31536000, httponly=True, samesite="Lax")
    return response


@require_GET
def api_admin_users(request):
    user, error = _api_user(request, admin=True)
    if error:
        return error
    users = User.objects.annotate(
        message_count=Count("support_messages"),
        unread_count=Count("support_messages", filter=Q(
            support_messages__sender_role="user",
            support_messages__read_at__isnull=True,
        )),
    ).order_by("-date_joined")
    return JsonResponse({"users": [{
        "id": item.id,
        "name": item.first_name or item.email or item.username,
        "email": item.email,
        "role": "admin" if item.is_staff else "user",
        "createdAt": item.date_joined.isoformat(),
        "messageCount": item.message_count,
        "unreadCount": item.unread_count,
    } for item in users]})


@require_GET
def api_admin_analytics(request):
    user, error = _api_user(request, admin=True)
    if error:
        return error
    totals = {
        "views": Visit.objects.count(),
        "visitors": Visit.objects.values("visitor_hash").distinct().count(),
        "signedInUsers": Visit.objects.exclude(user=None).values("user_id").distinct().count(),
    }
    today = timezone.localdate()
    start = today - timedelta(days=6)
    recent = Visit.objects.filter(visited_at__date__gte=start)
    daily = []
    for offset in range(7):
        day = start + timedelta(days=offset)
        day_visits = recent.filter(visited_at__date=day)
        daily.append({
            "day": day.isoformat(),
            "views": day_visits.count(),
            "visitors": day_visits.values("visitor_hash").distinct().count(),
        })
    pages = list(Visit.objects.values("pathname").annotate(views=Count("id")).order_by("-views")[:6])
    unread = SupportMessage.objects.filter(sender_role="user", read_at__isnull=True).count()
    return JsonResponse({"totals": totals, "daily": daily, "pages": pages, "unreadMessages": unread})
