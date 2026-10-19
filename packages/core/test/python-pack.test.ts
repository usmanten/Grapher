import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it } from 'vitest';

import { analyzeProject, type Graph } from '../src/index.js';
import { sqlTables } from '../src/analyze/packs/python/databases.js';
import { joinUrl } from '../src/analyze/packs/python/routes.js';
import schema from '../schema/graph.schema.json' with { type: 'json' };
import { makeProject, type Tree } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function graphOf(tree: Tree): Promise<Graph> {
  const created = await makeProject(tree);
  cleanups.push(created.cleanup);
  return (await analyzeProject(created.dir)).graph;
}

const strip = (id: string) => id.replace(/^file:/, '');

/** Every connection as `from -> to: label`. */
function lines(graph: Graph): string[] {
  return graph.connections.map((c) => `${strip(c.from)} -> ${strip(c.to)}: ${c.label}`);
}

const FLASK: Tree = {
  'requirements.txt': 'flask\nflask-sqlalchemy\npsycopg2-binary\nstripe\n',
  'app/__init__.py': [
    'import os',
    'from flask import Flask',
    'from flask_sqlalchemy import SQLAlchemy',
    '',
    'db = SQLAlchemy()',
    '',
    'def create_app():',
    '    app = Flask(__name__)',
    "    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ['DATABASE_URL']",
    '    db.init_app(app)',
    '    from .auth import bp as auth_bp',
    '    from . import shop',
    "    app.register_blueprint(auth_bp, url_prefix='/account')",
    '    app.register_blueprint(shop.bp)',
    '    return app',
  ].join('\n'),
  'app/models.py': [
    'from . import db',
    '',
    'class User(db.Model):',
    "    __tablename__ = 'users'",
    '    id = db.Column(db.Integer, primary_key=True)',
    '',
    'class OrderItem(db.Model):',
    '    id = db.Column(db.Integer, primary_key=True)',
  ].join('\n'),
  'app/auth.py': [
    'from flask import Blueprint, request',
    'from . import db',
    'from .models import User',
    '',
    "bp = Blueprint('auth', __name__, url_prefix='/auth')",
    '',
    "@bp.route('/login', methods=['GET', 'POST'])",
    'def login():',
    '    user = User.query.filter_by(email=request.form["email"]).first()',
    '    return "ok"',
    '',
    "@bp.post('/signup')",
    'def signup():',
    '    user = User(email="x")',
    '    db.session.add(user)',
    '    db.session.commit()',
    '    return "ok"',
  ].join('\n'),
  'app/shop.py': [
    'import os',
    'import requests',
    'import stripe',
    'from flask import Blueprint',
    'from .models import OrderItem',
    'from . import db',
    '',
    "bp = Blueprint('shop', __name__, url_prefix='/shop')",
    '',
    "@bp.route('/items/<int:item_id>', methods=['DELETE'])",
    'def remove(item_id):',
    '    OrderItem.query.filter_by(id=item_id).delete()',
    '',
    "@bp.get('/rates')",
    'def rates():',
    "    stripe.api_key = os.getenv('STRIPE_SECRET_KEY')",
    '    return requests.get(f\'https://api.shipping.example.com/rates?key={os.environ.get("SHIP_KEY")}\').json()',
  ].join('\n'),
  'migrations/versions/001_init.py': 'from alembic import op',
  'tests/test_auth.py': 'from app.auth import login',
};

const FASTAPI: Tree = {
  'pyproject.toml':
    '[project]\nname = "todo-api"\nversion = "0.1.0"\ndependencies = ["fastapi", "sqlmodel"]\n',
  'main.py': [
    'from fastapi import FastAPI',
    'from routers import items',
    'from db import engine',
    '',
    'app = FastAPI()',
    "app.include_router(items.router, prefix='/api')",
    '',
    "@app.get('/')",
    'def home():',
    '    return {}',
  ].join('\n'),
  'db.py': [
    'from sqlmodel import SQLModel, Field, create_engine, Session',
    'from config import settings',
    '',
    'engine = create_engine(settings.database_url)',
    '',
    'class Item(SQLModel, table=True):',
    '    id: int = Field(primary_key=True)',
    '',
    'class ItemCreate(SQLModel):',
    '    name: str',
  ].join('\n'),
  'config.py': [
    'from pydantic_settings import BaseSettings',
    '',
    'class Settings(BaseSettings):',
    "    database_url: str = 'sqlite:///todo.db'",
    '    openai_api_key: str',
    '',
    'settings = Settings()',
  ].join('\n'),
  'routers/__init__.py': '',
  'routers/items.py': [
    'from fastapi import APIRouter',
    'from sqlmodel import Session, select',
    'from openai import OpenAI',
    'import mystery_sdk',
    'from db import Item, engine',
    '',
    "router = APIRouter(prefix='/items')",
    '',
    "@router.get('')",
    'def list_items():',
    '    with Session(engine) as session:',
    '        return session.exec(select(Item)).all()',
    '',
    "@router.api_route('/{item_id}', methods=['PUT', 'PATCH'])",
    'def edit(item_id: int):',
    '    with Session(engine) as session:',
    '        item = session.get(Item, item_id)',
    '        session.add(item)',
    '        OpenAI()',
    '        mystery_sdk.ping()',
  ].join('\n'),
};

const DJANGO: Tree = {
  'manage.py': [
    'import os',
    "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mysite.settings')",
  ].join('\n'),
  'mysite/__init__.py': '',
  'mysite/settings.py': [
    'import environ',
    'env = environ.Env()',
    "SECRET_KEY = env('DJANGO_SECRET_KEY')",
    "INSTALLED_APPS = ['blog']",
    'DATABASES = {',
    "    'default': {'ENGINE': 'django.db.backends.postgresql', 'NAME': 'blog'}",
    '}',
  ].join('\n'),
  'mysite/urls.py': [
    'from django.contrib import admin',
    'from django.urls import include, path',
    '',
    'urlpatterns = [',
    "    path('admin/', admin.site.urls),",
    "    path('blog/', include('blog.urls')),",
    ']',
  ].join('\n'),
  'blog/__init__.py': '',
  'blog/models.py': [
    'from django.db import models',
    '',
    'class TimeStamped(models.Model):',
    '    class Meta:',
    '        abstract = True',
    '',
    'class Article(TimeStamped):',
    '    title = models.CharField(max_length=200)',
    '',
    'class Comment(models.Model):',
    '    class Meta:',
    "        db_table = 'blog_comments'",
  ].join('\n'),
  'blog/urls.py': [
    'from django.urls import path, re_path',
    'from . import views',
    'from .views import ArticleList',
    '',
    'urlpatterns = [',
    "    path('', ArticleList.as_view(), name='list'),",
    "    path('<int:pk>/', views.detail, name='detail'),",
    "    re_path(r'^archive/(?P<year>[0-9]{4})/$', views.archive),",
    "    path('<int:pk>/comment/', views.comment),",
    ']',
  ].join('\n'),
  'blog/views.py': [
    'from django.shortcuts import get_object_or_404',
    'from django.views.decorators.http import require_POST',
    'from django.views.generic import ListView',
    'from .models import Article, Comment',
    '',
    'class ArticleList(ListView):',
    '    model = Article',
    '',
    'def detail(request, pk):',
    '    return get_object_or_404(Article, pk=pk)',
    '',
    'def archive(request, year):',
    '    return Article.objects.filter(year=year)',
    '',
    '@require_POST',
    'def comment(request, pk):',
    '    c = Comment(article_id=pk)',
    '    c.save()',
  ].join('\n'),
  'blog/migrations/0001_initial.py': 'from django.db import migrations',
};

describe('python pack', () => {
  it('maps a Flask app: blueprints with prefixes, Flask-SQLAlchemy, services and settings', async () => {
    const graph = await graphOf(FLASK);
    expect(graph.project.framework).toBe('flask');
    expect(lines(graph)).toEqual([
      'app/__init__.py -> database:postgres: connects to',
      'app/__init__.py -> app/auth.py: uses bp',
      'app/__init__.py -> app/shop.py: uses shop',
      'app/__init__.py -> setting:DATABASE_URL: reads setting',
      'app/auth.py -> database:postgres: reads and saves users',
      'app/auth.py -> app/__init__.py: uses db',
      'app/auth.py -> app/models.py: uses User',
      'app/models.py -> app/__init__.py: uses db',
      'app/shop.py -> database:postgres: deletes from order_items',
      'app/shop.py -> app/__init__.py: uses db',
      'app/shop.py -> app/models.py: uses OrderItem',
      'app/shop.py -> service:api.shipping.example.com: uses api.shipping.example.com',
      'app/shop.py -> service:stripe: uses Stripe',
      'app/shop.py -> setting:SHIP_KEY: reads setting',
      'app/shop.py -> setting:STRIPE_SECRET_KEY: reads setting',
    ]);
    const auth = graph.nodes.find((n) => n.id === 'file:app/auth.py');
    // register_blueprint's url_prefix replaces the blueprint's own /auth.
    expect(auth).toMatchObject({
      role: 'route',
      methods: ['GET', 'POST'],
      routes: [
        { path: '/account/login', methods: ['GET', 'POST'] },
        { path: '/account/signup', methods: ['POST'] },
      ],
    });
    expect(graph.nodes.find((n) => n.id === 'file:app/shop.py')).toMatchObject({
      routes: [
        { path: '/shop/items/<int:item_id>', methods: ['DELETE'] },
        { path: '/shop/rates', methods: ['GET'] },
      ],
    });
    expect(graph.nodes.find((n) => n.id === 'database:postgres')).toMatchObject({
      label: 'Postgres',
      via: 'Flask-SQLAlchemy',
    });
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).not.toContain('file:migrations/versions/001_init.py');
    expect(ids).not.toContain('file:tests/test_auth.py');
    expect(graph.unknownPackages).toEqual([]);
  });

  it('maps a FastAPI app: routers, SQLModel and pydantic settings', async () => {
    const graph = await graphOf(FASTAPI);
    expect(graph.project).toEqual({ name: 'todo-api', framework: 'fastapi' });
    expect(lines(graph)).toEqual([
      'config.py -> setting:DATABASE_URL: reads setting',
      'config.py -> setting:OPENAI_API_KEY: reads setting',
      'db.py -> database:sqlite: connects to',
      'db.py -> config.py: uses settings',
      'main.py -> db.py: uses engine',
      'main.py -> routers/items.py: uses items',
      'routers/items.py -> database:sqlite: reads and saves items',
      'routers/items.py -> db.py: uses Item and engine',
      'routers/items.py -> service:mystery_sdk: uses the mystery_sdk package',
      'routers/items.py -> service:openai: uses OpenAI',
    ]);
    // include_router's prefix is added in front of the router's own.
    expect(graph.nodes.find((n) => n.id === 'file:routers/items.py')).toMatchObject({
      role: 'route',
      routes: [
        { path: '/api/items', methods: ['GET'] },
        { path: '/api/items/{item_id}', methods: ['PUT', 'PATCH'] },
      ],
    });
    expect(graph.nodes.find((n) => n.id === 'file:main.py')).toMatchObject({
      urlPath: '/',
      methods: ['GET'],
    });
    expect(graph.nodes.find((n) => n.id === 'database:sqlite')).toMatchObject({ via: 'SQLModel' });
    expect(graph.unknownPackages).toEqual(['mystery_sdk']);
  });

  it('maps a Django project: urls, include(), views and the ORM', async () => {
    const graph = await graphOf(DJANGO);
    expect(graph.project.framework).toBe('django');
    expect(lines(graph)).toEqual([
      'blog/urls.py -> blog/views.py: uses ArticleList and views',
      'blog/views.py -> database:postgres: reads and saves articles and blog_comments',
      'blog/views.py -> blog/models.py: uses Article and Comment',
      'mysite/settings.py -> database:postgres: connects to',
      'mysite/settings.py -> setting:DJANGO_SECRET_KEY: reads setting',
      'mysite/urls.py -> blog/urls.py: uses blog.urls',
    ]);
    const views = graph.nodes.find((n) => n.id === 'file:blog/views.py');
    expect(views).toMatchObject({
      role: 'route',
      routes: [
        { path: '/blog/', methods: [] },
        { path: '/blog/<int:pk>/', methods: [] },
        { path: '/blog/<int:pk>/comment/', methods: ['POST'] },
        { path: '/blog/archive/(?P<year>[0-9]{4})/', methods: [] },
      ],
    });
    // Some routes accept any method, so the file as a whole lists none.
    expect(views).not.toHaveProperty('methods');
    expect(graph.nodes.find((n) => n.id === 'file:mysite/settings.py')).toMatchObject({
      role: 'config',
    });
    expect(graph.nodes.find((n) => n.id === 'database:postgres')).toMatchObject({
      via: 'Django ORM',
    });
    expect(graph.nodes.map((n) => n.id)).not.toContain('file:blog/migrations/0001_initial.py');
  });

  it('reads Django saves, deletes and method decorators', async () => {
    const graph = await graphOf({
      'shop/models.py': 'from django.db.models import Model\nclass Order(Model):\n    pass',
      'shop/urls.py': [
        'from django.urls import path',
        'from shop.views import cancel, orders',
        'urlpatterns = [path("orders/", orders), path("orders/<int:pk>/cancel/", cancel)]',
      ].join('\n'),
      'shop/views.py': [
        'from django.views.decorators.http import require_http_methods',
        'from rest_framework.decorators import api_view',
        'from shop.models import Order',
        '',
        '@require_http_methods(["GET", "POST"])',
        'def orders(request):',
        '    Order.objects.get_or_create(name="x")',
        '',
        '@api_view(["DELETE"])',
        'def cancel(request, pk):',
        '    order = Order.objects.get(pk=pk)',
        '    order.delete()',
        '    Order.objects.filter(pk=pk).delete()',
      ].join('\n'),
    });
    expect(lines(graph)).toContain(
      'shop/views.py -> database:database: reads, saves and deletes orders',
    );
    expect(graph.nodes.find((n) => n.id === 'file:shop/views.py')).toMatchObject({
      methods: ['GET', 'POST', 'DELETE'],
      routes: [
        { path: '/orders/', methods: ['GET', 'POST'] },
        { path: '/orders/<int:pk>/cancel/', methods: ['DELETE'] },
      ],
    });
  });

  it('maps a single-file Flask app with SQLAlchemy sessions and statements', async () => {
    const graph = await graphOf({
      'app.py': [
        'from flask import Flask',
        'from sqlalchemy import create_engine, delete, select',
        'from sqlalchemy.orm import DeclarativeBase, Session',
        'import sqlite3',
        '',
        'app = Flask(__name__)',
        "engine = create_engine('mysql+pymysql://localhost/shop')",
        '',
        'class Base(DeclarativeBase):',
        '    pass',
        '',
        'class Product(Base):',
        "    __tablename__ = 'products'",
        '',
        'class Category(Base):',
        '    pass',
        '',
        "@app.route('/')",
        'def index():',
        '    with Session(engine) as session:',
        '        session.query(Product).all()',
        '        session.execute(delete(Category))',
        '',
        "@app.route('/p', methods=['POST'])",
        'def add():',
        '    session = Session(engine)',
        '    p = session.get(Product, 1)',
        '    session.delete(p)',
        '    session.add(thing)',
        '',
        'def raw():',
        "    sqlite3.connect('local.db')",
      ].join('\n'),
    });
    expect(lines(graph)).toEqual([
      // `session.add(thing)` is in a function that only mentions Product, so it counts as products.
      'app.py -> database:mysql: reads, saves and deletes categories and products',
      'app.py -> database:sqlite: connects to',
    ]);
    expect(graph.nodes.find((n) => n.id === 'database:mysql')).toMatchObject({
      label: 'MySQL',
      via: 'SQLAlchemy',
    });
    const routes = graph.nodes.find((n) => n.id === 'file:app.py');
    expect(routes).toMatchObject({
      routes: [
        { path: '/', methods: ['GET'] },
        { path: '/p', methods: ['POST'] },
      ],
    });
  });

  it('reads settings in every common style, and skips names Python sets itself', async () => {
    const graph = await graphOf({
      'settings.py': [
        'import os',
        'from os import environ, getenv',
        'from decouple import config',
        "A = os.environ['ALPHA']",
        "B = environ['BRAVO']",
        "C = getenv('CHARLIE', 'x')",
        "D = config('DELTA', default='')",
        "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'x')",
        "E = os.environ.get('PATH')",
        'F = os.environ.get(name)',
      ].join('\n'),
      'other.py': "def config(x): pass\nconfig('NOT_A_SETTING')",
    });
    expect(graph.nodes.filter((n) => n.kind === 'setting').map((n) => n.id)).toEqual([
      'setting:ALPHA',
      'setting:BRAVO',
      'setting:CHARLIE',
      'setting:DELTA',
    ]);
  });

  it('records outside requests by host only, and ignores local addresses', async () => {
    const graph = await graphOf({
      'client.py': [
        'import httpx',
        'import requests',
        "httpx.post('https://user:pw@hooks.example.com/x?token=abc')",
        "requests.request('GET', 'https://api.weather.example/v1')",
        "requests.get('http://localhost:8000/health')",
        'requests.get(url)',
      ].join('\n'),
    });
    expect(graph.nodes.filter((n) => n.kind === 'service').map((n) => n.id)).toEqual([
      'service:api.weather.example',
      'service:hooks.example.com',
    ]);
  });

  it('tells outside packages apart from the standard library and the project itself', async () => {
    const graph = await graphOf({
      'src/shop/__init__.py': '',
      'src/shop/main.py': [
        'import json',
        'import shop.helpers',
        'from shop import missing_module',
        'from google.cloud import storage',
        'import mysql.connector',
        'import numpy as np',
        'from celery import Celery',
        'import tinykv',
        '',
        'np.array([])',
      ].join('\n'),
      'src/shop/helpers.py': '',
    });
    expect(graph.nodes.filter((n) => n.kind !== 'file').map((n) => n.id)).toEqual([
      'database:mysql',
      'service:celery',
      'service:google.cloud.storage',
      'service:tinykv',
    ]);
    expect(graph.unknownPackages).toEqual(['tinykv']);
  });

  it('uses what Claude identified for packages Grapher does not know', async () => {
    const created = await makeProject({
      'a.py': 'import fastkv\nimport mailbird\nimport prettyprint',
    });
    cleanups.push(created.cleanup);
    const { graph } = await analyzeProject(created.dir, {
      identified: new Map([
        ['fastkv', { kind: 'database', label: 'FastKV' }],
        ['mailbird', { kind: 'service', label: 'Mailbird' }],
        ['prettyprint', { kind: 'library', label: 'prettyprint' }],
      ]),
    });
    expect(graph.nodes.filter((n) => n.kind !== 'file')).toEqual([
      {
        id: 'database:fastkv',
        kind: 'database',
        label: 'FastKV',
        via: 'fastkv',
        inferred: true,
        identifiedBy: 'ai',
      },
      {
        id: 'service:mailbird',
        kind: 'service',
        label: 'Mailbird',
        source: 'mailbird',
        identifiedBy: 'ai',
      },
    ]);
    expect(graph.unknownPackages).toEqual([]);
  });

  it('reads hand-written SQL, sent through the one database driver the project uses', async () => {
    const graph = await graphOf({
      'db.py': 'import sqlite3\ndef get_db():\n    return sqlite3.connect("app.db")',
      'blog.py': [
        'from db import get_db',
        'def index():',
        '    get_db().execute(',
        '        "SELECT p.id, title FROM post p"',
        '        " JOIN user u ON p.author_id = u.id"',
        '    ).fetchall()',
        '    get_db().execute("INSERT INTO post (title) VALUES (?)", (t,))',
        "    get_db().execute('UPDATE `post` SET title = ?', (t,))",
        '    get_db().execute("DELETE FROM post WHERE id = ?", (i,))',
        '    get_db().execute(f"SELECT * FROM {table}")',
        '    get_db().execute("PRAGMA foreign_keys = ON")',
      ].join('\n'),
    });
    expect(lines(graph)).toEqual([
      'blog.py -> database:sqlite: reads, saves and deletes post and user',
      'blog.py -> db.py: uses get_db',
      'db.py -> database:sqlite: connects to',
    ]);
  });

  it('never puts a database password into the graph', async () => {
    const password = ['hunter', 'Grapher', 'Fake', '42'].join('');
    const graph = await graphOf({
      'db.py': [
        'from sqlalchemy import create_engine',
        `engine = create_engine("postgresql://admin:${password}@db.internal/app")`,
      ].join('\n'),
      'models.py': 'from sqlalchemy.orm import declarative_base\nBase = declarative_base()',
    });
    expect(lines(graph)).toEqual(['db.py -> database:postgres: connects to']);
    expect(JSON.stringify(graph)).not.toContain(password);
  });

  it('produces graphs that match graph.schema.json', async () => {
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    for (const tree of [FLASK, FASTAPI, DJANGO]) {
      const graph = await graphOf(tree);
      expect(validate(graph), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it('lets JavaScript and Python files share one project', async () => {
    const graph = await graphOf({
      'package.json': JSON.stringify({ name: 'mixed' }),
      'web/index.ts': 'export const x = 1;',
      'api/main.py':
        "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/ping')\ndef ping(): pass",
    });
    expect(graph.project).toEqual({ name: 'mixed', framework: 'fastapi' });
    // A FastAPI project with some scripts isn't a Next.js project missing its app/ folder.
    expect(graph.warnings).toEqual([]);
    expect(graph.nodes.map((n) => n.id)).toEqual(['file:api/main.py', 'file:web/index.ts']);
  });
});

describe('joinUrl', () => {
  it('joins prefixes and paths with single slashes', () => {
    expect(joinUrl('', '')).toBe('/');
    expect(joinUrl('/api/', '/items')).toBe('/api/items');
    expect(joinUrl('blog/', '<int:pk>/')).toBe('/blog/<int:pk>/');
  });
});

describe('sqlTables', () => {
  it('finds the tables a line of SQL reads, saves or deletes', () => {
    expect(sqlTables('WITH x AS (SELECT 1) SELECT * FROM a JOIN "b" ON 1')).toEqual([
      { table: 'a', operation: 'reads' },
      { table: 'b', operation: 'reads' },
    ]);
    expect(sqlTables('insert or replace into [users] values (?)')).toEqual([
      { table: 'users', operation: 'saves' },
    ]);
    expect(sqlTables('CREATE TABLE users (id int)')).toEqual([]);
  });
});
