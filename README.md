# FormSpace — Django-проект о 3D-моделировании

Полноценный локальный сайт на Django 5.2 LTS, HTML, CSS и JavaScript с базой SQLite.

## Возможности

- адаптивная главная страница о 3D-моделировании;
- регистрация и авторизация через Django Auth;
- безопасное хеширование паролей, сессии и CSRF-защита;
- роли пользователя и администратора;
- личный кабинет с профилем и персональными настройками;
- чат обратной связи между пользователем и администратором;
- авторская админ-панель с пользователями, сообщениями и аналитикой;
- стандартная Django Admin по адресу `/django-admin/`;
- SQLite-база `db.sqlite3`, создаваемая миграциями.

## Быстрый запуск в Windows

1. Установите Python 3.11 или новее, если он ещё не установлен.
2. Дважды щёлкните `START.bat`.
3. При первом запуске автоматически создастся `.venv`, Django установится из локальных wheel-файлов без интернета, выполнятся миграции и создадутся демонстрационные аккаунты.
4. Сайт откроется по адресу `http://127.0.0.1:8000`.

## Ручной запуск

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --no-index --find-links vendor\wheels -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 127.0.0.1:8000
```

## Демонстрационные аккаунты

Пользователь:

- email: `user@formspace.local`
- пароль: `User123!`

Администратор:

- email: `admin@formspace.local`
- пароль: `Admin123!`

Перед публикацией задайте `DJANGO_SECRET_KEY`, отключите `DJANGO_DEBUG`, настройте `DJANGO_ALLOWED_HOSTS` и смените демонстрационные пароли.

## Структура

```text
Diplom/
├── formspace/              # настройки и корневые URL Django
├── core/                   # модели, views, URL, миграции, команды
├── templates/              # HTML-шаблоны
├── static/core/            # CSS, JavaScript и favicon
├── vendor/wheels/          # локальные зависимости для установки без интернета
├── manage.py
├── requirements.txt
└── START.bat
```

## Модели базы данных

- стандартный `User` Django — аккаунты и роли;
- `UserProfile` — биография и персональные настройки;
- `SupportMessage` — сообщения пользователя и администратора;
- `Visit` — обезличенная аналитика посещений.

Для реального размещения используйте HTTPS, постоянную базу данных PostgreSQL, переменные окружения для секретов и отдельный production-сервер (например, Gunicorn/Uvicorn за Nginx).
