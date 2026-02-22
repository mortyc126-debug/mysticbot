# ✦ Мистикум — Telegram Mini App

## 🚀 Быстрый старт

### Установка
```bash
cd mysticbot
npm install
npm run dev
```
Открой http://localhost:5173 — увидишь приложение.

---

## 📁 Структура проекта

```
mysticbot/
├── src/
│   ├── pages/
│   │   ├── Onboarding.jsx    ← Регистрация (7 шагов)
│   │   ├── Home.jsx          ← Главная: гороскоп, карта дня, фичи
│   │   ├── Tarot.jsx         ← Гадание: расклады, карты, интерпретация
│   │   ├── Astrology.jsx     ← Астрология: натальная карта, совместимость
│   │   ├── DiaryPage.jsx     ← Дневник судьбы + Сонник + Статистика
│   │   └── Profile.jsx       ← Профиль + Подписки + Магазин удачи
│   │
│   ├── components/
│   │   ├── UI.jsx            ← Переиспользуемые компоненты (Card, Btn, etc.)
│   │   ├── BottomNav.jsx     ← Нижняя навигация
│   │   └── LuckToast.jsx     ← Уведомления об удаче
│   │
│   ├── data/
│   │   └── tarot.js          ← 78 карт Таро, расклады, знаки зодиака, руны
│   │
│   ├── hooks/
│   │   └── useAppState.js    ← Глобальное состояние приложения
│   │
│   ├── App.jsx               ← Роутинг и звёзды на фоне
│   ├── main.jsx              ← Точка входа
│   └── index.css             ← Глобальные стили и анимации
│
├── index.html
├── package.json
└── vite.config.js
```

---

## 🔌 Что подключать потом

### 1. Claude API (AI интерпретации)
Найди в коде комментарии `// TODO: CLAUDE API ИНТЕГРАЦИЯ`.

Нужно создать backend (Python FastAPI) с endpoint'ами:
- `POST /api/horoscope` — персональный гороскоп
- `POST /api/tarot/interpret` — интерпретация расклада
- `POST /api/palmistry` — анализ фото руки
- `POST /api/rune` — создание руны-оберега
- `POST /api/aura` — проверка ауры

### 2. Telegram Payments
Найди комментарии `// TODO: TELEGRAM PAYMENTS`.

```js
// Пример оплаты через Telegram:
const tg = window.Telegram.WebApp;
tg.openInvoice(invoiceUrl, (status) => {
  if (status === "paid") {
    // активировать подписку
  }
});
```

### 3. TON Платежи (криптовалюта)
```js
// TON Connect для оплаты в TON:
import TonConnect from "@tonconnect/sdk";
const connector = new TonConnect({ manifestUrl: "..." });
```

### 4. Telegram WebApp SDK
В `index.html` раскомментировать:
```html
<script src="https://telegram.org/js/telegram-web-app.js"></script>
```

В `App.jsx` раскомментировать инициализацию:
```js
const tg = window.Telegram.WebApp;
tg.ready(); tg.expand();
```

### 5. Backend (Python)
Смотри комментарии в `useAppState.js` — там описаны все API endpoint'ы с форматом данных.

---

## 🎯 Тарифы
- **Бесплатный**: гороскоп, 1 карта Таро в день, сонник
- **Базовый (249₽/мес)**: все расклады на 3 карты, совместимость, лунный календарь
- **VIP (499₽/мес)**: натальная карта, хиромантия, руны, аура, персональный астролог

## 💫 Система удачи
- Зарабатывается за активность (streak, чтение гороскопа, дневник)
- Тратится на дополнительные функции
- Можно докупить: 50💫=49₽, 120💫=99₽, 300💫=199₽
