"use strict";

/**
 * ============================================================================
 * КОНФІГУРАЦІЙНИЙ БЛОК (Динамічна архітектура без хардкоду)
 * При зміні номера варіанта або кількості карток весь ланцюжок
 * запиту до API та рендерингу DOM перебудовується автоматично.
 * ============================================================================
 */
const APP_CONFIG = {
  studentVariant: 24,
  table1RowOverride: null, // null = автоматичний розрахунок ((variant - 1) mod 20) + 1 -> рядок 4
  apiUrl: "https://randomuser.me/api/",
  resultsCount: 5, // Кількість профілів за один запит (5 колонок як у прикладі методички)
  includeTitleInName: false, // false = "First Last" (як на скріншоті методички), true = "Title First Last"
};

/**
 * Матриця відповідності всіх 20 варіантів Таблиці 1 номерам рядків Таблиці 2.
 * Для варіанта 24 -> рядок 4: поля [1, 2, 4, 6, 8] (picture, name, city, postcode, phone).
 */
const TABLE1_VARIANTS = {
  1: [1, 2, 3, 4, 5],
  2: [1, 3, 4, 5, 6],
  3: [1, 4, 5, 6, 7],
  4: [1, 2, 4, 6, 8],
  5: [1, 3, 5, 7, 9],
  6: [1, 2, 4, 5, 6],
  7: [1, 3, 4, 6, 7],
  8: [1, 2, 5, 6, 8],
  9: [1, 4, 6, 3, 2],
  10: [1, 3, 4, 7, 9],
  11: [1, 4, 5, 2, 6],
  12: [1, 5, 7, 8, 9],
  13: [1, 8, 9, 6, 5],
  14: [1, 6, 4, 2, 7],
  15: [1, 3, 5, 6, 7],
  16: [1, 7, 2, 8, 4],
  17: [1, 4, 3, 5, 7],
  18: [1, 5, 6, 8, 2],
  19: [1, 4, 2, 3, 8],
  20: [1, 6, 9, 7, 4],
};

/**
 * Повний словник усіх 9 полів із Таблиці 2 методичних вказівок
 * із функціями безпечного вилучення даних із JSON-об'єкта користувача.
 */
const FIELD_DEFINITIONS = {
  1: {
    key: "picture",
    label: "Picture",
    isImage: true,
    extract: (user) => user?.picture?.large || user?.picture?.medium || "",
  },
  2: {
    key: "name",
    label: "Name",
    isImage: false,
    extract: (user) => {
      if (!user?.name) return "N/A";
      const parts = APP_CONFIG.includeTitleInName
        ? [user.name.title, user.name.first, user.name.last]
        : [user.name.first, user.name.last];
      return parts.filter(Boolean).join(" ");
    },
  },
  3: {
    key: "cell",
    label: "Cell",
    isImage: false,
    extract: (user) => String(user?.cell ?? "N/A"),
  },
  4: {
    key: "city",
    label: "City",
    isImage: false,
    extract: (user) => String(user?.location?.city ?? "N/A"),
  },
  5: {
    key: "country",
    label: "Country",
    isImage: false,
    extract: (user) => String(user?.location?.country ?? "N/A"),
  },
  6: {
    key: "postcode",
    label: "Postcode",
    isImage: false,
    extract: (user) => String(user?.location?.postcode ?? "N/A"),
  },
  7: {
    key: "email",
    label: "E-mail",
    isImage: false,
    extract: (user) => String(user?.email ?? "N/A"),
  },
  8: {
    key: "phone",
    label: "Phone",
    isImage: false,
    extract: (user) => String(user?.phone ?? "N/A"),
  },
  9: {
    key: "coordinates",
    label: "Coordinates",
    isImage: false,
    extract: (user) => {
      const lat = user?.location?.coordinates?.latitude;
      const lon = user?.location?.coordinates?.longitude;
      return lat && lon ? `${lat}, ${lon}` : "N/A";
    },
  },
};

/**
 * Обчислює номер рядка у Таблиці 1 (1..20) для поточного варіанта студента.
 * @returns {number} Номер рядка Таблиці 1
 */
function getTable1RowIndex() {
  if (APP_CONFIG.table1RowOverride) {
    return APP_CONFIG.table1RowOverride;
  }
  const totalVariants = Object.keys(TABLE1_VARIANTS).length;
  return ((APP_CONFIG.studentVariant - 1) % totalVariants) + 1;
}

/**
 * Повертає масив ідентифікаторів полів Таблиці 2 для поточного варіанта.
 * @returns {number[]} Масив номерів полів (для вар. 24 -> [1, 2, 4, 6, 8])
 */
function getActiveFieldIds() {
  const rowIndex = getTable1RowIndex();
  return TABLE1_VARIANTS[rowIndex] || TABLE1_VARIANTS[4];
}

/**
 * Оновлює текстовий індикатор статусу виконання запиту під кнопкою Download.
 * @param {string} text - Повідомлення для виведення
 * @param {boolean} [isError=false] - Чи є повідомлення помилкою
 */
function updateStatusMessage(text, isError = false) {
  const statusEl = document.getElementById("status-message");
  if (!statusEl) return;

  statusEl.textContent = text;
  statusEl.classList.toggle("status-error", isError);
}

/**
 * Створює DOM-елемент картки одного користувача згідно з полями активного варіанта.
 * Використовує виключно безпечні методи createElement та textContent (без innerHTML).
 * @param {Object} user - Об'єкт користувача з масиву results JSON-відповіді
 * @param {number[]} fieldIds - Масив номерів полів із Таблиці 2
 * @returns {HTMLElement} Згенерований елемент <article class="user-card">
 */
function createUserCardElement(user, fieldIds) {
  const card = document.createElement("article");
  card.className = "user-card";

  const fullName = FIELD_DEFINITIONS[2].extract(user);

  // 1. Якщо у варіанті присутнє поле №1 (picture), додаємо верхній блок із фотографією
  if (fieldIds.includes(1)) {
    const photoWrapper = document.createElement("div");
    photoWrapper.className = "user-photo-wrapper";

    const img = document.createElement("img");
    img.className = "user-photo";
    img.src = FIELD_DEFINITIONS[1].extract(user);
    img.alt = `Фото користувача ${fullName}`;
    img.loading = "lazy";

    photoWrapper.appendChild(img);
    card.appendChild(photoWrapper);
  }

  // 2. Формуємо список текстових характеристик відповідно до порядку полів у Таблиці 1
  const detailsList = document.createElement("ul");
  detailsList.className = "user-details";

  fieldIds.forEach((fieldId) => {
    const def = FIELD_DEFINITIONS[fieldId];
    if (!def || def.isImage) return;

    const li = document.createElement("li");
    li.className = "user-detail-item";

    const labelSpan = document.createElement("span");
    labelSpan.className = "user-detail-label";
    labelSpan.textContent = `${def.label}: `;

    const valueNode = document.createTextNode(def.extract(user));

    li.appendChild(labelSpan);
    li.appendChild(valueNode);
    detailsList.appendChild(li);
  });

  card.appendChild(detailsList);
  return card;
}

/**
 * Очищує контейнер та рендерить усі отримані профілі користувачів на сторінку.
 * @param {Array<Object>} users - Масив об'єктів користувачів із поля results
 */
function renderUsersGrid(users) {
  const container = document.getElementById("users-container");
  if (!container) return;

  // Синхронізуємо CSS-змінну кількості колонок із конфігурацією
  container.style.setProperty("--cards-count", String(APP_CONFIG.resultsCount));
  container.innerHTML = "";

  const activeFieldIds = getActiveFieldIds();
  const fragment = document.createDocumentFragment();

  users.forEach((user) => {
    const cardElement = createUserCardElement(user, activeFieldIds);
    fragment.appendChild(cardElement);
  });

  container.appendChild(fragment);
}

/**
 * Виконує HTTP GET-запит до https://randomuser.me/api за допомогою fetch()
 * та повертає Promise із розпарсеним JSON-об'єктом.
 * @param {number} count - Кількість користувачів для отримання
 * @returns {Promise<Array<Object>>} Проміс, що резолвиться масивом користувачів
 */
function fetchRandomUsers(count) {
  const requestUrl = `${APP_CONFIG.apiUrl}?results=${encodeURIComponent(count)}&noinfo`;

  return fetch(requestUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Помилка HTTP: статус ${response.status} (${response.statusText})`);
      }
      // Перетворення JSON-рядка відповіді у власний об'єкт JavaScript
      return response.json();
    })
    .then((jsonData) => {
      if (!jsonData || !Array.isArray(jsonData.results)) {
        throw new Error("Некоректний формат JSON: відсутній масив results.");
      }
      return jsonData.results;
    });
}

/**
 * Обробник натискання кнопки Download: керує станом інтерфейсу та ланцюжком Promise.
 */
function handleDownloadClick() {
  const downloadBtn = document.getElementById("btn-download");
  if (downloadBtn) {
    downloadBtn.disabled = true;
  }

  updateStatusMessage("loading...", false);

  fetchRandomUsers(APP_CONFIG.resultsCount)
    .then((users) => {
      renderUsersGrid(users);
      updateStatusMessage("success!", false);
    })
    .catch((error) => {
      console.error("Помилка отримання даних із RandomUser API:", error);
      updateStatusMessage(`error: ${error.message}`, true);
    })
    .finally(() => {
      if (downloadBtn) {
        downloadBtn.disabled = false;
      }
    });
}

/**
 * Точка входу: ініціалізація обробників подій після завантаження DOM.
 */
document.addEventListener("DOMContentLoaded", () => {
  const downloadBtn = document.getElementById("btn-download");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", handleDownloadClick);
  }
});


function fetchRandomUsers(count) {
  const requestUrl = `${APP_CONFIG.apiUrl}?results=${encodeURIComponent(count)}&noinfo`;

  return fetch(requestUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Помилка HTTP: статус ${response.status} (${response.statusText})`);
      }
      return response.json();
    })
    .then((jsonData) => {
      if (!jsonData || !Array.isArray(jsonData.results)) {
        throw new Error("Некоректний формат JSON: відсутній масив results.");
      }
      return jsonData.results;
    });
}
