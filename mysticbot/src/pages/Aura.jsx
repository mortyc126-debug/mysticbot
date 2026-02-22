// ============================================================
// АУРА — определение цвета ауры по анкете
// API: src/api/claude.js → analyzeAura (подключить позже)
// Доступ: VIP — базовая, Premium — детальная
// ============================================================

import { useState, useRef } from "react";
import { Card, Btn, SLabel, AppHeader, Badge, LoadingSpinner } from "../components/UI";
import ClaudeAPI from "../api/claude";
import PhotosAPI from "../api/photos";
import TelegramSDK from "../api/telegram";

// ── 7 цветов ауры ──────────────────────────────────────────
const AURA_COLORS = [
  {
    id: "red", name: "Красная", hex: "#ef4444",
    gradient: "linear-gradient(135deg,#ef4444,#dc2626)",
    meaning: "Энергия, страсть, сила воли",
    description: "Красная аура — признак мощной жизненной силы. Ты полон энергии, решимости и стремления к действию. Сейчас важно направить этот огонь в правильное русло.",
    advice: "Направь энергию на конкретную цель. Избегай импульсивных решений — твоя сила в осознанном действии.",
    element: "Огонь", chakra: "Муладхара (корневая)",
  },
  {
    id: "orange", name: "Оранжевая", hex: "#f97316",
    gradient: "linear-gradient(135deg,#f97316,#ea580c)",
    meaning: "Творчество, радость, социальность",
    description: "Оранжевая аура говорит о творческом подъёме и желании общения. Ты открыт новому, тебя тянет создавать и делиться с миром.",
    advice: "Используй творческий поток — начни проект, запиши идею, нарисуй что-то. Энергия творчества сейчас на максимуме.",
    element: "Огонь/Вода", chakra: "Свадхистхана (сакральная)",
  },
  {
    id: "yellow", name: "Жёлтая", hex: "#eab308",
    gradient: "linear-gradient(135deg,#eab308,#ca8a04)",
    meaning: "Интеллект, оптимизм, ясность",
    description: "Жёлтая аура — свет разума. Ясность мышления, аналитические способности и позитивный настрой — твои суперсилы прямо сейчас.",
    advice: "Принимай важные решения именно сейчас — ум особенно ясен. Хорошее время для обучения и планирования.",
    element: "Воздух", chakra: "Манипура (солнечное сплетение)",
  },
  {
    id: "green", name: "Зелёная", hex: "#22c55e",
    gradient: "linear-gradient(135deg,#22c55e,#16a34a)",
    meaning: "Баланс, рост, исцеление",
    description: "Зелёная аура — знак гармонии и внутреннего баланса. Ты в фазе роста и восстановления. Природа и спокойствие — твои союзники.",
    advice: "Проведи время на природе. Позаботься о теле — оно сейчас особенно отзывчиво к исцелению.",
    element: "Земля", chakra: "Анахата (сердечная)",
  },
  {
    id: "blue", name: "Синяя", hex: "#3b82f6",
    gradient: "linear-gradient(135deg,#3b82f6,#2563eb)",
    meaning: "Спокойствие, интуиция, правда",
    description: "Синяя аура — глубина и спокойствие. Ты в контакте с внутренней истиной. Интуиция обострена, слова обретают особый вес.",
    advice: "Доверяй внутреннему голосу. Сейчас хорошее время для медитации и честных разговоров.",
    element: "Вода", chakra: "Вишуддха (горловая)",
  },
  {
    id: "indigo", name: "Индиго", hex: "#6366f1",
    gradient: "linear-gradient(135deg,#6366f1,#4f46e5)",
    meaning: "Духовность, мудрость, ясновидение",
    description: "Аура индиго — редкая и глубокая. Ты сейчас на пороге духовного прозрения. Вещие сны и сильная интуиция — не случайность.",
    advice: "Веди дневник снов. Медитируй перед сном — ответы придут через образы и ощущения.",
    element: "Эфир", chakra: "Аджна (третий глаз)",
  },
  {
    id: "violet", name: "Фиолетовая", hex: "#8b5cf6",
    gradient: "linear-gradient(135deg,#8b5cf6,#7c3aed)",
    meaning: "Трансформация, мистика, связь с высшим",
    description: "Фиолетовая аура — высшая вибрация. Ты в процессе глубокой трансформации. Связь с тонким миром усилена, интуиция на пике.",
    advice: "Довершай начатое, отпускай старое. Трансформация требует мужества — ты готов.",
    element: "Свет", chakra: "Сахасрара (коронная)",
  },
];

// ── Вопросы анкеты (20 вопросов) ────────────────────────────
const QUESTIONS = [
  {
    id: "mood",
    question: "Если бы твоё сегодняшнее настроение было погодой — что бы это было?",
    options: [
      { label: "Гроза с молниями — резко, мощно, живо", scores: { red: 3, orange: 2 } },
      { label: "Солнечный ветер — легко, светло, в движении", scores: { yellow: 3, orange: 2, green: 1 } },
      { label: "Туман над водой — глубоко, тихо, задумчиво", scores: { indigo: 3, blue: 2, violet: 1 } },
      { label: "Мягкий дождь — спокойно, уютно, немного меланхолично", scores: { blue: 3, green: 2 } },
    ],
  },
  {
    id: "room",
    question: "Ты заходишь в пустую незнакомую комнату. Что делаешь первым?",
    options: [
      { label: "Открываю окно — нужен воздух и простор", scores: { red: 2, yellow: 2, orange: 1 } },
      { label: "Замечаю детали — текстуры, запахи, свет", scores: { indigo: 3, violet: 2, blue: 1 } },
      { label: "Нахожу угол и устраиваюсь там", scores: { blue: 3, green: 2 } },
      { label: "Включаю музыку, чтобы наполнить пространство", scores: { orange: 3, red: 1, yellow: 1 } },
    ],
  },
  {
    id: "body",
    question: "Как ты ощущаешь своё тело сегодня?",
    options: [
      { label: "Заряженно — хочется двигаться и действовать", scores: { red: 3, orange: 1 } },
      { label: "Тяжело — нужно больше сна и покоя", scores: { indigo: 2, blue: 2, violet: 1 } },
      { label: "Спокойно, в балансе — ничего не беспокоит", scores: { green: 3, blue: 2 } },
      { label: "Лёгкость — почти невесомость в голове", scores: { yellow: 3, violet: 1 } },
    ],
  },
  {
    id: "focus",
    question: "Чего тебе сейчас больше всего не хватает?",
    options: [
      { label: "Близости — чтобы кто-то рядом и понимал", scores: { green: 2, orange: 2, red: 1 } },
      { label: "Движения — новых событий, прорыва", scores: { red: 2, yellow: 2, orange: 1 } },
      { label: "Тишины — побыть наедине с собой", scores: { indigo: 3, violet: 2 } },
      { label: "Гармонии — чтобы всё встало на свои места", scores: { green: 2, blue: 3 } },
    ],
  },
  {
    id: "dream",
    question: "Какие сны приходят к тебе последнее время?",
    options: [
      { label: "Активные — погони, дороги, куда-то несёт", scores: { red: 2, orange: 2, yellow: 1 } },
      { label: "Спокойные — природа, вода, открытые пространства", scores: { green: 2, blue: 2 } },
      { label: "Странные, символичные — помнишь образами", scores: { indigo: 3, violet: 2 } },
      { label: "Почти не снится или сразу забываю", scores: { yellow: 1, green: 1, blue: 1 } },
    ],
  },
  {
    id: "social",
    question: "После тяжёлого дня — что первым делом восстанавливает тебя?",
    options: [
      { label: "Живое общение — друзья, разговоры, смех", scores: { orange: 3, red: 2, yellow: 1 } },
      { label: "Полная тишина и никого рядом", scores: { indigo: 3, blue: 2, violet: 1 } },
      { label: "Прогулка на природе или что-то сделанное руками", scores: { green: 3, orange: 1 } },
      { label: "Медитация, дневник, долгое молчаливое чаепитие", scores: { violet: 3, indigo: 2, blue: 1 } },
    ],
  },
  {
    id: "time",
    question: "В какое время суток ты чувствуешь себя наиболее собой?",
    options: [
      { label: "Раннее утро — рассвет, пока все спят", scores: { yellow: 3, green: 2 } },
      { label: "День — в гуще событий, всё кипит", scores: { red: 3, orange: 2, yellow: 1 } },
      { label: "Вечер — закат, долгие мысли, тёплый свет", scores: { blue: 3, indigo: 2 } },
      { label: "Глубокая ночь — тишина, звёзды, тайна", scores: { violet: 3, indigo: 3, blue: 1 } },
    ],
  },
  {
    id: "decision",
    question: "Завтра важный разговор, который изменит многое. Как готовишься?",
    options: [
      { label: "Не готовлюсь — доверяю первому ощущению в моменте", scores: { indigo: 3, violet: 2, blue: 1 } },
      { label: "Прокручиваю варианты, строю логику", scores: { yellow: 3, orange: 1 } },
      { label: "Думаю, как это почувствуют другие люди", scores: { green: 3, orange: 2, red: 1 } },
      { label: "Жду знака — сон, случайная фраза, совпадение", scores: { violet: 3, indigo: 2 } },
    ],
  },
  {
    id: "element",
    question: "Какая стихия ближе к твоей энергии прямо сейчас?",
    options: [
      { label: "Огонь — страсть, тепло, трансформация", scores: { red: 3, orange: 2, yellow: 1 } },
      { label: "Земля — устойчивость, корни, запах леса", scores: { green: 3, orange: 1 } },
      { label: "Вода — глубина, растворение, течение", scores: { blue: 3, violet: 2, indigo: 1 } },
      { label: "Воздух — свобода, мысль, пространство над головой", scores: { yellow: 3, blue: 1, indigo: 1 } },
    ],
  },
  {
    id: "music",
    question: "Какой звук точнее всего описывает твоё состояние сейчас?",
    options: [
      { label: "Ритм — барабаны, бас, хочется двигаться", scores: { red: 3, orange: 2 } },
      { label: "Тишина с редкими нотами — пространство и глубина", scores: { indigo: 3, violet: 2, blue: 2 } },
      { label: "Лёгкая мелодия — хочется улыбаться без причины", scores: { yellow: 3, orange: 2, green: 1 } },
      { label: "Что-то минорное — красиво и немного грустно", scores: { blue: 3, violet: 2 } },
    ],
  },
  {
    id: "challenge",
    question: "Всё пошло не по плану. Что происходит внутри тебя в первые минуты?",
    options: [
      { label: "Сразу ищу выход — беру контроль в руки", scores: { red: 3, yellow: 2, orange: 1 } },
      { label: "Ухожу в себя — нужно переварить в тишине", scores: { indigo: 3, blue: 2, violet: 1 } },
      { label: "Хочу поговорить — выговориться близкому", scores: { green: 3, orange: 2 } },
      { label: "Ищу смысл — зачем это случилось именно сейчас", scores: { violet: 3, indigo: 2, blue: 1 } },
    ],
  },
  {
    id: "desire",
    question: "Если бы завтра ни о чём не нужно было думать — куда бы отправился?",
    options: [
      { label: "Туда, где громко и людно — на концерт, в город", scores: { red: 3, orange: 3 } },
      { label: "На природу — лес, берег, горы, подальше от людей", scores: { green: 3, blue: 2 } },
      { label: "В одиночество и размышления — книги, дневник, мысли", scores: { indigo: 3, violet: 2 } },
      { label: "Туда, где можно получить признание и результат", scores: { yellow: 3, red: 2, orange: 1 } },
    ],
  },
  {
    id: "crowd",
    question: "Кем ты чаще всего бываешь в компании людей?",
    options: [
      { label: "Центром — вокруг тебя всё закручивается", scores: { yellow: 3, red: 2, orange: 1 } },
      { label: "Тем, кто слушает и чувствует настроение каждого", scores: { green: 3, blue: 2, indigo: 1 } },
      { label: "Тем, кто говорит неожиданное и всех удивляет", scores: { orange: 2, violet: 3 } },
      { label: "Наблюдателем — замечаешь то, что другие пропускают", scores: { indigo: 3, blue: 2 } },
    ],
  },
  {
    id: "expression",
    question: "Как ты чаще всего выражаешь то, что у тебя внутри?",
    options: [
      { label: "Через действие — делаю, а не говорю", scores: { red: 3, orange: 2, yellow: 1 } },
      { label: "Через слова — рассказываю, объясняю, пишу", scores: { yellow: 3, orange: 1, blue: 1 } },
      { label: "Через творчество — рисую, создаю, придумываю", scores: { indigo: 2, violet: 3, orange: 2 } },
      { label: "Через молчание — присутствие говорит само за себя", scores: { blue: 3, indigo: 2, green: 1 } },
    ],
  },
  {
    id: "fear",
    question: "Что сильнее всего тебя сейчас опустошает?",
    options: [
      { label: "Топтание на месте — когда нет движения вперёд", scores: { red: 2, orange: 2, yellow: 1 } },
      { label: "Хаос и непредсказуемость — когда ничего не ясно", scores: { green: 2, blue: 2 } },
      { label: "Ощущение, что не понимаю себя и свой путь", scores: { indigo: 3, violet: 2 } },
      { label: "Одиночество — когда рядом никого настоящего", scores: { orange: 3, green: 2 } },
    ],
  },
  {
    id: "gift",
    question: "Что окружающие чаще всего замечают в тебе?",
    options: [
      { label: "Энергию и харизму — от тебя сложно оторваться", scores: { red: 3, orange: 2 } },
      { label: "Глубину и мудрость — с тобой хочется говорить часами", scores: { indigo: 3, blue: 2, violet: 1 } },
      { label: "Тепло и заботу — рядом с тобой безопасно", scores: { green: 3, orange: 1 } },
      { label: "Ясность ума — умеешь объяснять сложное просто", scores: { yellow: 3, blue: 1 } },
    ],
  },
  {
    id: "spiritual",
    question: "Как ты относишься к судьбе и тому, что нас ведёт?",
    options: [
      { label: "Верю в знаки — вселенная говорит через совпадения", scores: { violet: 3, indigo: 2 } },
      { label: "Верю в себя — сам строю свою жизнь", scores: { red: 3, yellow: 2 } },
      { label: "Верю в природный ритм — всему своё время", scores: { green: 3, blue: 2 } },
      { label: "Ищу смысл — вопросов больше, чем ответов", scores: { indigo: 3, violet: 2, blue: 1 } },
    ],
  },
  {
    id: "moon",
    question: "Какая лунная фаза ощущается ближе к твоей энергии?",
    options: [
      { label: "Растущая — время роста, хочется начинать новое", scores: { green: 3, orange: 2, yellow: 1 } },
      { label: "Полнолуние — пик силы, всё обострено", scores: { indigo: 3, violet: 2, red: 1 } },
      { label: "Убывающая — время отпускать и очищаться", scores: { blue: 3, green: 2, violet: 1 } },
      { label: "Новолуние — тишина, скрытый потенциал, пауза", scores: { indigo: 3, violet: 3, blue: 1 } },
    ],
  },
  {
    id: "scent",
    question: "Какой запах точнее всего описывает твоё состояние прямо сейчас?",
    options: [
      { label: "Дым, специи, горячая смола — остро и тепло", scores: { red: 3, orange: 2 } },
      { label: "Хвойный лес или трава после дождя — свежо и живо", scores: { green: 3, blue: 2, indigo: 1 } },
      { label: "Ладан, ночные цветы — глубоко и мистически", scores: { indigo: 3, violet: 3 } },
      { label: "Цитрус, морской бриз — ясно и в движении", scores: { yellow: 3, orange: 2, green: 1 } },
    ],
  },
  {
    id: "message",
    question: "Если бы вселенная послала тебе послание прямо сейчас — что бы ты хотел услышать?",
    options: [
      { label: "«Ты на верном пути — продолжай»", scores: { red: 2, yellow: 2, green: 2 } },
      { label: "«Остановись и прислушайся — ответ уже внутри»", scores: { indigo: 3, violet: 2, blue: 2 } },
      { label: "«Отпусти контроль — доверься потоку»", scores: { blue: 3, green: 2, violet: 1 } },
      { label: "«Твоё время пришло — действуй»", scores: { red: 3, orange: 2, yellow: 1 } },
    ],
  },
];

// Вычислить цвет ауры по ответам
function calculateAura(answers) {
  const scores = {};
  AURA_COLORS.forEach(c => { scores[c.id] = 0; });

  answers.forEach((answerIdx, qIdx) => {
    const option = QUESTIONS[qIdx]?.options[answerIdx];
    if (!option) return;
    Object.entries(option.scores).forEach(([colorId, score]) => {
      scores[colorId] = (scores[colorId] || 0) + score;
    });
  });

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primaryId = sorted[0][0];
  const secondaryId = sorted[1]?.[0];

  const primary = AURA_COLORS.find(c => c.id === primaryId);
  const secondary = AURA_COLORS.find(c => c.id === secondaryId);

  return { primary, secondary, scores };
}

export default function Aura({ state, showToast }) {
  const { user, canAccess, setCurrentPage, goBack, addLuck, addDailyEnergy, updateOracleMemory,
          shopPurchases, useShopPurchase, unlockAchievement } = state;

  const [step, setStep]           = useState("intro"); // intro | quiz | loading | result
  const [currentQ, setCurrentQ]   = useState(0);
  const [answers, setAnswers]     = useState([]);
  const [result, setResult]       = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [loadingAI, setLoadingAI] = useState(false);

  // Аура по фото
  const [photoAura, setPhotoAura]       = useState(null);   // { url, base64, mime }
  const [photoResult, setPhotoResult]   = useState(null);   // { description }
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const photoRef = useRef(null);

  const isVip = canAccess("vip");
  const isPremium = canAccess("premium");
  const auraPurchased = shopPurchases?.aura || 0;
  const auraDeepPurchased = shopPurchases?.aura_deep || 0;

  const handleStart = () => {
    if (!isVip && auraPurchased <= 0) {
      showToast("⭐ Аура доступна в VIP тарифе или купи в Магазине удачи (✨ 30 💫)");
      TelegramSDK.haptic.notification("warning");
      return;
    }
    setStep("quiz");
    setCurrentQ(0);
    setAnswers([]);
    setResult(null);
    setAiAnalysis(null);
  };

  const handleAnswer = (optionIdx) => {
    TelegramSDK.haptic.selection();
    const newAnswers = [...answers, optionIdx];
    setAnswers(newAnswers);

    if (currentQ < QUESTIONS.length - 1) {
      setCurrentQ(currentQ + 1);
    } else {
      // Все вопросы отвечены — вычисляем
      setStep("loading");

      const auraResult = calculateAura(newAnswers);
      setResult(auraResult);
      if (auraResult?.primary?.name) {
        updateOracleMemory?.({ aura_color: auraResult.primary.name });
      }

      // Имитация загрузки для эффекта
      setTimeout(() => {
        setStep("result");
        TelegramSDK.haptic.notification("success");
        addLuck(2, "Анализ ауры");
        addDailyEnergy();
        unlockAchievement?.("aura_scan");
        showToast("✨ +2 💫 Аура раскрыта!");
      }, 1800);

      // Автоматический анализ ауры через Grok (VIP и выше видят сразу)
      if (isVip) {
        (async () => {
          try {
            const ai = await ClaudeAPI.analyzeAura({
              answers: newAnswers.map((a, i) => ({
                question: QUESTIONS[i].question,
                answer: QUESTIONS[i].options[a].label,
              })),
              birthDate: user.birth_date,
              userContext: state.getContextForClaude(),
              deep: false,
            });
            if (ai) setAiAnalysis(ai);
          } catch {}
        })();
      }
    }
  };

  const handleDeepAnalysis = async () => {
    // Проверяем загрузку ДО списания попытки — иначе двойной клик тратит покупку впустую
    if (loadingAI) return;
    const hasDeepAccess = isPremium || auraDeepPurchased > 0 || auraPurchased > 0;
    if (!hasDeepAccess) {
      showToast("👑 Нужен Премиум или купи в Магазине удачи (🌌 60 💫 или ✨ 30 💫)");
      return;
    }
    // Списываем купленную попытку до запроса: сначала берём aura_deep, затем aura
    if (!isPremium) {
      if (auraDeepPurchased > 0) {
        useShopPurchase?.("aura_deep");
      } else {
        useShopPurchase?.("aura");
      }
    }
    setLoadingAI(true);
    TelegramSDK.haptic.impact("medium");

    try {
      const ai = await ClaudeAPI.analyzeAura({
        answers: answers.map((a, i) => ({
          question: QUESTIONS[i].question,
          answer: QUESTIONS[i].options[a].label,
        })),
        birthDate: user.birth_date,
        userContext: state.getContextForClaude(),
        deep: true,
      });
      setAiAnalysis(ai || {
        deepDescription: `${user.name || "Ты"}, твоя аура сейчас вибрирует на частоте ${result.primary.name.toLowerCase()} — это говорит о ${result.primary.meaning.toLowerCase()}. Знак ${user.sun_sign || "Рыбы"} усиливает эту энергию. Вторичный оттенок ${result.secondary?.name.toLowerCase() || ""} добавляет глубины и нюансов.`,
      });
    } catch {
      setAiAnalysis({
        deepDescription: `Глубокий анализ твоей ауры показывает сильную вибрацию ${result.primary.name.toLowerCase()} энергии с оттенком ${result.secondary?.name.toLowerCase() || "фиолетового"}. Это указывает на период ${result.primary.meaning.toLowerCase()}.`,
      });
    }

    setLoadingAI(false);
  };

  const handleReset = () => {
    setStep("intro");
    setCurrentQ(0);
    setAnswers([]);
    setResult(null);
    setAiAnalysis(null);
  };

  // ── Аура по фото ──────────────────────────────────────────
  const handlePhotoFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("❌ Нужно изображение"); return; }
    if (file.size > 10 * 1024 * 1024) { showToast("❌ Файл слишком большой (>10МБ)"); return; }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(",")[1];
      const photo = { url: URL.createObjectURL(file), base64, mime: file.type };
      setPhotoAura(photo);
      setPhotoResult(null);
      TelegramSDK.haptic.impact("light");

      if (!isPremium) {
        showToast("👑 Аура по фото — Премиум услуга");
        return;
      }

      setLoadingPhoto(true);
      TelegramSDK.haptic.impact("medium");
      try {
        const ai = await ClaudeAPI.analyzeAuraByPhoto({
          imageBase64: base64,
          mimeType: file.type,
          userContext: state.getContextForClaude(),
        });
        setPhotoResult(ai || { description: "Вселенная видит твою ауру, но канал сейчас закрыт. Попробуй ещё раз." });
        addLuck(4, "Аура по фото");
        addDailyEnergy();
        showToast("✨ +4 💫 Аура прочитана по фото!");
        TelegramSDK.haptic.notification("success");

        // Сохраняем фото в Storage (фоново)
        if (user?.telegram_id) {
          PhotosAPI.uploadPhoto({
            telegramId: user.telegram_id,
            type: "aura",
            base64,
            mimeType: file.type,
            reading: ai?.description?.slice(0, 2000),
          }).catch(err => console.warn("[Aura] photo save failed:", err.message));
        }
      } catch {
        setPhotoResult({ description: "Энергетическое поле зафиксировано, но прочтение временно недоступно. Попробуй ещё раз." });
      }
      setLoadingPhoto(false);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <AppHeader title="✨ Аура" luckPoints={user.luck_points} streak={user.streak_days} />

      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Назад */}
        <button
          onClick={goBack}
          style={{
            background: "none", border: "none", color: "var(--text2)",
            fontSize: 13, cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", gap: 6, padding: 0,
          }}
        >
          ← Назад
        </button>

        {/* === ВВОДНЫЙ ЭКРАН === */}
        {step === "intro" && (
          <>
            {/* Объяснение: что такое аура */}
            <Card style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>✨ Что такое аура?</div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.75 }}>
                Аура — это энергетическое поле, которое окружает каждого человека. Оно отражает твоё внутреннее состояние: эмоции, мысли, жизненный тонус, уровень стресса и духовную настроенность прямо сейчас.
              </div>
              <div style={{
                margin: "12px 0", borderTop: "1px solid var(--border)", paddingTop: 12,
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 16 }}>🎨</span>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                    <b style={{ color: "var(--text)" }}>Цвет ауры</b> — у каждого человека аура имеет доминирующий оттенок, связанный с его энергетическим состоянием. Красная — страсть и сила. Синяя — спокойствие и интуиция. Фиолетовая — трансформация и мистика.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 16 }}>🔄</span>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                    <b style={{ color: "var(--text)" }}>Аура меняется</b> — она не постоянна. На неё влияют сон, стресс, отношения, настроение. Сегодняшняя аура — это слепок твоего состояния именно сейчас.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 16 }}>🧭</span>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                    <b style={{ color: "var(--text)" }}>Зачем знать?</b> — понимая свой цвет, ты видишь, куда уходит энергия, и получаешь совет, как её восстановить и направить в нужную сторону.
                  </div>
                </div>
              </div>
            </Card>

            <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
              <div style={{
                width: 100, height: 100, borderRadius: "50%", margin: "0 auto 16px",
                background: "radial-gradient(circle, rgba(139,92,246,0.3), rgba(139,92,246,0.05) 70%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: "auraGlow 3s ease-in-out infinite",
                fontSize: 48,
              }}>
                ✨
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Аура прямо сейчас</h2>
              <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.65 }}>
                Ответь на 20 вопросов — узнай цвет ауры в этот момент, активные чакры и получи персональный анализ от оракула.
              </p>
              <div style={{ marginTop: 8, display: "inline-block" }}>
                <Badge tier="vip" />
              </div>
            </div>

            {/* Блок: почему важно отслеживать ауру */}
            <Card style={{ marginTop: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>
                🔄 Аура меняется каждый день
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7, marginBottom: 14 }}>
                Аура — это не постоянная метка, а живое энергетическое состояние. Оно меняется под влиянием настроения, стресса, отношений, сна и даже погоды. Как у всего живого, у твоей ауры есть свои подъёмы и спады.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div style={{
                  background: "rgba(239,68,68,0.07)", borderRadius: 12, padding: "10px 12px",
                  border: "1px solid rgba(239,68,68,0.18)",
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#ef4444", marginBottom: 6 }}>
                    ⬇ Слабая аура
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.6 }}>
                    Усталость без причины<br/>
                    Тоска и апатия<br/>
                    Раздражительность<br/>
                    Ощущение «что-то не так»<br/>
                    Тяжело принимать решения
                  </div>
                </div>
                <div style={{
                  background: "rgba(34,197,94,0.07)", borderRadius: 12, padding: "10px 12px",
                  border: "1px solid rgba(34,197,94,0.18)",
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#22c55e", marginBottom: 6 }}>
                    ⬆ Сильная аура
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.6 }}>
                    Ясность и лёгкость<br/>
                    Энергия и мотивация<br/>
                    Притяжение к людям<br/>
                    Ощущение потока<br/>
                    Уверенность в выборе
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.65, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                Регулярная проверка помогает замечать, когда аура ослабевает, и вовремя восстанавливать энергию — вместо того чтобы удивляться, откуда берётся подавленность или усталость.
              </div>
            </Card>

            {/* Цвета ауры — превью */}
            <SLabel>🌈 7 цветов ауры</SLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {AURA_COLORS.slice(0, 4).map(c => (
                <div key={c.id} style={{
                  background: "var(--card)", borderRadius: 14, padding: "10px 6px",
                  textAlign: "center", border: "1px solid var(--border)",
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", margin: "0 auto 6px",
                    background: c.gradient, boxShadow: `0 0 10px ${c.hex}40`,
                  }} />
                  <div style={{ fontSize: 9, color: "var(--text2)", fontWeight: 700 }}>{c.name}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {AURA_COLORS.slice(4).map(c => (
                <div key={c.id} style={{
                  background: "var(--card)", borderRadius: 14, padding: "10px 6px",
                  textAlign: "center", border: "1px solid var(--border)",
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", margin: "0 auto 6px",
                    background: c.gradient, boxShadow: `0 0 10px ${c.hex}40`,
                  }} />
                  <div style={{ fontSize: 9, color: "var(--text2)", fontWeight: 700 }}>{c.name}</div>
                </div>
              ))}
            </div>

            <Btn onClick={handleStart} disabled={!isVip && auraPurchased <= 0}>
              {isVip || auraPurchased > 0 ? "✨ Начать определение ауры" : "🔒 Нужен VIP тариф"}
            </Btn>
            {!isVip && (
              <Btn variant="ghost" onClick={goBack}>
                Узнать про тарифы
              </Btn>
            )}

            {/* ── Аура по фото + чакры (Premium) ─────────── */}
            <div style={{ marginTop: 8 }}>
              <SLabel>📸 Аура по фото + чакры <span style={{ color: "var(--gold2)", fontSize: 10 }}>ПРЕМИУМ</span></SLabel>
              <Card style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.65, marginBottom: 12 }}>
                  Загрузи своё фото — оракул прочитает цвет твоей ауры, состояние чакр и откроет скрытый потенциал прямо по образу.
                </div>

                {/* Превью фото */}
                {photoAura && (
                  <div style={{ marginBottom: 12, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
                    <img src={photoAura.url} alt="Фото ауры" style={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }} />
                  </div>
                )}

                {/* Скрытый input */}
                <input ref={photoRef} type="file" accept="image/*" onChange={handlePhotoFile} style={{ display: "none" }} />

                {loadingPhoto ? (
                  <div style={{ textAlign: "center", padding: "16px 0" }}>
                    <LoadingSpinner size={28} label="Оракул читает ауру..." />
                  </div>
                ) : (
                  <Btn
                    variant={isPremium ? "default" : "ghost"}
                    onClick={() => {
                      if (!isPremium) { showToast("👑 Аура по фото доступна в Премиум тарифе"); setCurrentPage("profile"); return; }
                      photoRef.current?.click();
                    }}
                  >
                    {isPremium ? (photoAura ? "📸 Загрузить другое фото" : "📸 Загрузить фото") : "🔒 Нужен Премиум"}
                  </Btn>
                )}

                {/* Результат */}
                {photoResult?.description && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, marginBottom: 8 }}>✦ Чтение ауры</div>
                    <div style={{ fontSize: 13, lineHeight: 1.75, color: "var(--text)" }}>
                      {photoResult.description}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </>
        )}

        {/* === АНКЕТА === */}
        {step === "quiz" && (
          <>
            {/* Прогресс */}
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              {QUESTIONS.map((_, i) => (
                <div key={i} style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: i <= currentQ
                    ? "var(--accent)"
                    : "var(--bg3)",
                  transition: "background 0.3s",
                }} />
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 4 }}>
              Вопрос {currentQ + 1} из {QUESTIONS.length}
            </div>

            <Card key={currentQ} glow style={{ animation: "fadeInUp 0.3s ease both" }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 16, lineHeight: 1.5 }}>
                {QUESTIONS[currentQ].question}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {QUESTIONS[currentQ].options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => handleAnswer(i)}
                    style={{
                      width: "100%", textAlign: "left",
                      background: "var(--bg3)", border: "1px solid var(--border)",
                      borderRadius: 12, padding: "12px 14px", fontSize: 13,
                      color: "var(--text)", cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)";
                      e.currentTarget.style.background = "rgba(139,92,246,0.06)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.background = "var(--bg3)";
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* === ЗАГРУЗКА === */}
        {step === "loading" && (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <div style={{
              width: 90, height: 90, borderRadius: "50%", margin: "0 auto 20px",
              background: "radial-gradient(circle, rgba(139,92,246,0.4), transparent 70%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              animation: "auraGlow 1.5s ease-in-out infinite, float 2s ease-in-out infinite",
            }}>
              <div style={{ fontSize: 40 }}>✨</div>
            </div>
            <LoadingSpinner size={28} />
            <div style={{ fontSize: 14, color: "var(--text2)", marginTop: 16 }}>
              Определяю цвет твоей ауры...
            </div>
          </div>
        )}

        {/* === РЕЗУЛЬТАТ === */}
        {step === "result" && result && (
          <>
            {/* Основной цвет ауры */}
            <div style={{ textAlign: "center", padding: "8px 0 0" }}>
              <div style={{
                width: 110, height: 110, borderRadius: "50%", margin: "0 auto 16px",
                background: `radial-gradient(circle, ${result.primary.hex}60, ${result.primary.hex}10 70%)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: "auraGlow 2.5s ease-in-out infinite",
                boxShadow: `0 0 40px ${result.primary.hex}40`,
                "--aura-color": `${result.primary.hex}80`,
              }}>
                <div style={{
                  width: 60, height: 60, borderRadius: "50%",
                  background: result.primary.gradient,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 26,
                  boxShadow: `0 0 20px ${result.primary.hex}60`,
                }}>
                  ✦
                </div>
              </div>

              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>
                <span style={{
                  background: result.primary.gradient,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}>
                  {result.primary.name} аура
                </span>
              </h2>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}>
                {result.primary.meaning}
              </div>
              {result.secondary && (
                <div style={{ fontSize: 11, color: "var(--text2)" }}>
                  Вторичный оттенок: <span style={{ color: result.secondary.hex, fontWeight: 700 }}>
                    {result.secondary.name}
                  </span>
                </div>
              )}
            </div>

            {/* Описание */}
            <Card glow style={{ "--aura-color": `${result.primary.hex}40` }}>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)", marginBottom: 12 }}>
                {result.primary.description}
              </div>
              <div style={{
                display: "flex", gap: 12,
                background: "var(--bg3)", borderRadius: 10, padding: "10px 12px",
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 2 }}>Стихия</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{result.primary.element}</div>
                </div>
                <div style={{ width: 1, background: "var(--border)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 2 }}>Чакра</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{result.primary.chakra}</div>
                </div>
              </div>
            </Card>

            {/* Совет */}
            <Card>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 22 }}>💡</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Совет ауры</div>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                    {result.primary.advice}
                  </div>
                </div>
              </div>
            </Card>

            {/* AI анализ */}
            {aiAnalysis?.deepDescription && (
              <Card glow>
                <SLabel>🔮 Глубокий анализ</SLabel>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)", marginTop: 10 }}>
                  {aiAnalysis.deepDescription}
                </div>
              </Card>
            )}

            {!aiAnalysis?.deepDescription && (canAccess("premium") || auraPurchased > 0) && (
              <Btn
                variant="gold"
                onClick={handleDeepAnalysis}
                disabled={loadingAI}
              >
                {loadingAI
                  ? "Читаю ауру..."
                  : auraPurchased > 0 && !canAccess("premium")
                    ? `✨ Глубокое прочтение ауры (${auraPurchased} куплено)`
                    : "👑 Глубокое прочтение ауры"}
              </Btn>
            )}
            {!aiAnalysis?.deepDescription && !canAccess("premium") && auraPurchased <= 0 && (
              <div style={{
                background: "rgba(245,158,11,0.06)", borderRadius: 12, padding: "10px 14px",
                border: "1px solid rgba(245,158,11,0.15)", fontSize: 12, color: "var(--text2)",
                display: "flex", gap: 8, alignItems: "center",
              }}>
                <span>👑</span>
                <span>Глубокое прочтение ауры доступно в <strong style={{ color: "var(--gold2)" }}>Премиум</strong> тарифе или купи в Магазине удачи</span>
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" onClick={handleReset} style={{ flex: 1 }}>↺ Заново</Btn>
              <Btn variant="ghost" onClick={() => setCurrentPage("home")} style={{ flex: 1 }}>← На главную</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
