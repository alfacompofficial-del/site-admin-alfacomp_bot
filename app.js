// ============================================================================
// ALFA COMP ADMIN PANEL — CLIENT LOGIC & REALTIME SYNC
// ============================================================================

// Конфигурация по умолчанию
const DEFAULT_CONFIG = {
  supabaseUrl: "https://ycmohbpxytajjlerxowc.supabase.co",
  supabaseKey: "sb_publishable_6R5og9bW_71t1T47QqdkSg_Ocab50CV",
  botToken: "8977573836:AAFHi0ogLPMmm8cCb2Wv09KJpVToHkAw4R8",
  usdRate: 12850,
};

// Загружаем сохраненные настройки из localStorage
const config = {
  supabaseUrl: localStorage.getItem("ac_sb_url") || DEFAULT_CONFIG.supabaseUrl,
  supabaseKey: localStorage.getItem("ac_sb_key") || DEFAULT_CONFIG.supabaseKey,
  botToken: localStorage.getItem("ac_bot_token") || DEFAULT_CONFIG.botToken,
  usdRate: parseFloat(localStorage.getItem("ac_usd_rate") || DEFAULT_CONFIG.usdRate),
};

// Инициализируем клиент Supabase
let supabase = null;
try {
  supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
} catch (e) {
  console.error("Supabase init error:", e);
}

// Состояние приложения (State)
const state = {
  users: [],
  products: [],
  orders: [],
  activeUser: null,
  activeMessages: [],
  filterUsers: "all",
  searchUsers: "",
  webhookInfo: null,
};

// ============================================================================
//  ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  initFormCalculators();
  initEventListeners();
  loadConfigToInputs();

  // Загружаем данные из Supabase
  await refreshAll();

  // Проверяем статус вебхука Telegram
  await checkWebhookStatus();

  // Подключаем Realtime подписки Supabase
  setupRealtimeSubscriptions();

  // Периодическое фоновое обновление статуса (каждые 30 секунд)
  setInterval(() => {
    if (state.activeUser) {
      loadMessagesForUser(state.activeUser.telegram_id, true);
    }
  }, 10000);
});

// ============================================================================
//  НАВИГАЦИЯ ПО ВКЛАДКАМ
// ============================================================================
function initTabs() {
  const navButtons = document.querySelectorAll(".nav-btn");
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      navButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".tab-pane").forEach((pane) => {
        pane.classList.remove("active");
      });
      const activePane = document.getElementById(targetTab);
      if (activePane) activePane.classList.add("active");
    });
  });
}

function switchToTab(tabId) {
  const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  if (btn) btn.click();
}

// ============================================================================
//  ЗАГРУЗКА И ОБНОВЛЕНИЕ ВСЕХ ДАННЫХ
// ============================================================================
async function refreshAll() {
  showToast("🔄 Синхронизация данных с Supabase...", "info");
  await Promise.all([loadUsers(), loadProducts(), loadOrders()]);
  updateKpiMetrics();
  showToast("✅ Данные обновлены!", "success");
}

function updateKpiMetrics() {
  document.getElementById("kpi-users").textContent = state.users.length;
  document.getElementById("kpi-products").textContent = state.products.length;
  document.getElementById("kpi-orders").textContent = state.orders.length;
  document.getElementById("kpi-rate").textContent = `${config.usdRate.toLocaleString("ru-RU")} сум`;
}

// ============================================================================
//  1. УПРАВЛЕНИЕ КЛИЕНТАМИ И ЧАТОМ
// ============================================================================
async function loadUsers() {
  try {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("last_active_at", { ascending: false });

    if (error) throw error;
    state.users = data || [];
    renderUsersList();
  } catch (err) {
    console.error("Error loading users:", err);
  }
}

function renderUsersList() {
  const container = document.getElementById("users-list-container");
  const countPill = document.getElementById("users-count-pill");

  let list = [...state.users];

  // Фильтр по типу
  if (state.filterUsers === "active") {
    list = list.filter((u) => !u.is_blocked);
  } else if (state.filterUsers === "blocked") {
    list = list.filter((u) => u.is_blocked);
  }

  // Поиск
  if (state.searchUsers) {
    const q = state.searchUsers.toLowerCase();
    list = list.filter((u) => {
      const name = `${u.first_name || ""} ${u.last_name || ""}`.toLowerCase();
      const user = (u.username || "").toLowerCase();
      const phone = (u.phone || "").toLowerCase();
      const id = String(u.telegram_id);
      return name.includes(q) || user.includes(q) || phone.includes(q) || id.includes(q);
    });
  }

  countPill.textContent = list.length;

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px; color:var(--text-dim); font-size:13px;">
        Клиенты не найдены
      </div>`;
    return;
  }

  container.innerHTML = list
    .map((u) => {
      const isActive = state.activeUser && state.activeUser.telegram_id === u.telegram_id;
      const initial = (u.first_name || u.username || "U")[0].toUpperCase();
      const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ") || `Пользователь #${u.telegram_id}`;
      const timeStr = u.last_active_at ? formatDate(u.last_active_at) : "";

      return `
      <div class="user-item-card ${isActive ? "active" : ""}" onclick="selectUser(${u.telegram_id})">
        <div class="user-item-avatar ${u.is_blocked ? "blocked" : ""}">
          ${initial}
        </div>
        <div class="user-item-meta">
          <div class="user-item-row-top">
            <span class="user-item-name">${escapeHtml(fullName)}</span>
            <span class="user-item-time">${timeStr}</span>
          </div>
          <div class="user-item-row-sub">
            <span class="user-item-snippet">${u.username ? "@" + u.username : (u.phone || `ID: ${u.telegram_id}`)}</span>
            ${u.is_blocked ? '<span class="badge-blocked">🚫 Блок</span>' : ""}
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

window.selectUser = async function (telegramId) {
  const user = state.users.find((u) => u.telegram_id === telegramId);
  if (!user) return;

  state.activeUser = user;
  renderUsersList();

  // Переключаем плейсхолдер на карточку чата
  document.getElementById("chat-empty-placeholder").style.display = "none";
  document.getElementById("chat-active-card").style.display = "flex";

  // Заполняем шапку диалога
  const initial = (user.first_name || user.username || "U")[0].toUpperCase();
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || `Клиент #${user.telegram_id}`;

  document.getElementById("active-chat-avatar").textContent = initial;
  document.getElementById("active-chat-name").textContent = fullName;
  document.getElementById("active-chat-username").textContent = user.username ? `@${user.username}` : "юзернейм скрыт";
  document.getElementById("active-chat-phone").textContent = user.phone ? `тел: ${user.phone}` : "тел: не указан";
  document.getElementById("active-chat-id").textContent = user.telegram_id;

  // Кнопка блокировки (Требование 3)
  updateBlockButtonUI(user.is_blocked);

  // Ссылка на Telegram
  const tgLink = user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.telegram_id}`;
  document.getElementById("btn-open-tg").href = tgLink;

  // Загружаем сообщения
  await loadMessagesForUser(user.telegram_id);
};

// Функция блокировки/разблокировки пользователя (ТРЕБОВАНИЕ 3)
window.toggleActiveUserBlock = async function () {
  if (!state.activeUser) return;

  const currentBlocked = Boolean(state.activeUser.is_blocked);
  const newBlocked = !currentBlocked;
  const actionName = newBlocked ? "заблокировать" : "разблокировать";

  if (!confirm(`Вы действительно хотите ${actionName} пользователя ${state.activeUser.first_name || state.activeUser.telegram_id}? ${newBlocked ? "Бот перестанет отвечать на его сообщения." : "Бот снова сможет отвечать ему."}`)) {
    return;
  }

  try {
    const { error } = await supabase
      .from("customers")
      .update({ is_blocked: newBlocked })
      .eq("telegram_id", state.activeUser.telegram_id);

    if (error) throw error;

    state.activeUser.is_blocked = newBlocked;
    const userIndex = state.users.findIndex((u) => u.telegram_id === state.activeUser.telegram_id);
    if (userIndex !== -1) {
      state.users[userIndex].is_blocked = newBlocked;
    }

    updateBlockButtonUI(newBlocked);
    renderUsersList();

    const toastMsg = newBlocked
      ? "🚫 Пользователь заблокирован! Бот ему больше не ответит."
      : "✅ Пользователь разблокирован! Бот снова доступен.";
    showToast(toastMsg, newBlocked ? "error" : "success");
  } catch (err) {
    console.error("Error toggling block:", err);
    showToast(`Ошибка изменения статуса: ${err.message}`, "error");
  }
};

function updateBlockButtonUI(isBlocked) {
  const btn = document.getElementById("btn-toggle-block");
  const btnText = document.getElementById("block-btn-text");
  const statusBadge = document.getElementById("active-chat-status");

  if (isBlocked) {
    btn.className = "btn-block-action unblock";
    btnText.textContent = "✅ Разблокировать";
    statusBadge.className = "badge-status-pill blocked";
    statusBadge.textContent = "🚫 Заблокирован";
  } else {
    btn.className = "btn-block-action";
    btnText.textContent = "🚫 Заблокировать";
    statusBadge.className = "badge-status-pill";
    statusBadge.textContent = "🟢 Активен";
  }
}

// Загрузка сообщений переписки
async function loadMessagesForUser(telegramId, silent = false) {
  try {
    const { data, error } = await supabase
      .from("bot_messages")
      .select("*")
      .eq("telegram_id", telegramId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });

    if (error) throw error;
    state.activeMessages = data || [];
    renderMessages(silent);
  } catch (err) {
    console.error("Error loading messages:", err);
  }
}

// Рендер сообщений
function renderMessages(silent = false) {
  const container = document.getElementById("chat-messages-container");
  if (!state.activeUser) return;

  if (state.activeMessages.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:50px; color:var(--text-dim); font-size:13px;">
        История сообщений пуста.<br>Напишите первое сообщение ниже от имени бота!
      </div>`;
    return;
  }

  container.innerHTML = state.activeMessages
    .map((m) => {
      const isAdmin = m.sender === "admin";
      const timeStr = formatDate(m.created_at);

      return `
      <div class="msg-bubble-row ${isAdmin ? "from-admin" : "from-user"}" id="msg-row-${m.id}">
        ${
          isAdmin
            ? `
          <div class="msg-hover-actions">
            <button class="action-chip-btn" onclick="openEditMessageModal(${m.id}, ${m.telegram_message_id || 0}, '${escapeJs(m.text)}')">
              ✏️ Изменить
            </button>
            <button class="action-chip-btn delete" onclick="deleteMessage(${m.id}, ${m.telegram_message_id || 0})">
              🗑 Удалить
            </button>
          </div>
        `
            : ""
        }
        <div class="msg-bubble">
          <div class="msg-header-title">
            ${isAdmin ? "👑 Вы (Администратор Alfa Comp)" : `👤 ${escapeHtml(state.activeUser.first_name || "Клиент")}`}
          </div>
          <div class="msg-body-content">${escapeHtml(m.text).replace(/\n/g, "<br>")}</div>
          <div class="msg-time-status">
            ${m.is_edited ? '<span style="font-style:italic;">(изм.)</span>' : ""}
            <span>${timeStr}</span>
            ${isAdmin ? "<span>✓✓</span>" : ""}
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  if (!silent) {
    container.scrollTop = container.scrollHeight;
  }
}

// Отправка сообщения клиенту в Telegram (ТРЕБОВАНИЕ 1)
async function sendAdminMessage() {
  if (!state.activeUser) return;
  const input = document.getElementById("chat-message-input");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  const chatId = state.activeUser.telegram_id;

  try {
    // 1. Отправляем напрямую в Telegram через Bot API
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });
    const tgResult = await res.json();

    if (!tgResult.ok) {
      throw new Error(tgResult.description || "Ошибка отправки в Telegram");
    }

    const tgMessageId = tgResult.result.message_id;

    // 2. Сохраняем в Supabase bot_messages
    const { data: savedMsg, error } = await supabase
      .from("bot_messages")
      .insert({
        telegram_id: chatId,
        sender: "admin",
        telegram_message_id: tgMessageId,
        text: text,
      })
      .select()
      .single();

    if (error) {
      console.warn("Saved to TG, but error in Supabase:", error);
    } else if (savedMsg) {
      state.activeMessages.push(savedMsg);
      renderMessages();
    }

    showToast("✅ Сообщение доставлено в Telegram!", "success");
  } catch (err) {
    console.error("Send error:", err);
    showToast(`❌ Ошибка: ${err.message}`, "error");
  }
}

// Редактирование сообщения в Telegram (ТРЕБОВАНИЕ 2)
window.openEditMessageModal = function (msgId, tgMsgId, currentText) {
  document.getElementById("edit-msg-id").value = msgId;
  document.getElementById("edit-msg-tg-id").value = tgMsgId;
  document.getElementById("edit-msg-text").value = currentText;
  document.getElementById("modal-edit-message").style.display = "flex";
};

async function handleEditMessageSubmit(e) {
  e.preventDefault();
  const msgId = document.getElementById("edit-msg-id").value;
  const tgMsgId = document.getElementById("edit-msg-tg-id").value;
  const newText = document.getElementById("edit-msg-text").value.trim();

  if (!newText || !state.activeUser) return;

  try {
    // 1. Если есть telegram_message_id, редактируем прямо в Telegram
    if (tgMsgId && tgMsgId !== "0") {
      const res = await fetch(`https://api.telegram.org/bot${config.botToken}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: state.activeUser.telegram_id,
          message_id: parseInt(tgMsgId, 10),
          text: newText,
        }),
      });
      const tgResult = await res.json();
      if (!tgResult.ok) {
        console.warn("Telegram edit warning:", tgResult.description);
      }
    }

    // 2. Обновляем запись в базе данных Supabase
    await supabase
      .from("bot_messages")
      .update({ text: newText, is_edited: true })
      .eq("id", msgId);

    // Локальное обновление
    const msg = state.activeMessages.find((m) => m.id == msgId);
    if (msg) {
      msg.text = newText;
      msg.is_edited = true;
    }
    renderMessages();

    document.getElementById("modal-edit-message").style.display = "none";
    showToast("✏️ Сообщение изменено в Telegram!", "success");
  } catch (err) {
    console.error("Edit error:", err);
    showToast(`Ошибка: ${err.message}`, "error");
  }
}

// Удаление сообщения в Telegram (ТРЕБОВАНИЕ 2)
window.deleteMessage = async function (msgId, tgMsgId) {
  if (!confirm("Удалить это сообщение из Telegram? Оно исчезнет у клиента.")) return;

  try {
    // 1. Удаляем в Telegram
    if (tgMsgId && tgMsgId !== "0" && state.activeUser) {
      await fetch(`https://api.telegram.org/bot${config.botToken}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: state.activeUser.telegram_id,
          message_id: parseInt(tgMsgId, 10),
        }),
      });
    }

    // 2. Помечаем как удаленное в Supabase
    await supabase
      .from("bot_messages")
      .update({ is_deleted: true })
      .eq("id", msgId);

    state.activeMessages = state.activeMessages.filter((m) => m.id != msgId);
    renderMessages();

    showToast("🗑 Сообщение удалено из Telegram!", "success");
  } catch (err) {
    console.error("Delete message error:", err);
    showToast(`Ошибка удаления: ${err.message}`, "error");
  }
};

// ============================================================================
//  2. УПРАВЛЕНИЕ ТОВАРАМИ МАГАЗИНА (ТРЕБОВАНИЕ 4)
// ============================================================================
async function loadProducts() {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("priority", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw error;
    state.products = data || [];
    renderProductsList();
    populateProductFilters();
  } catch (err) {
    console.error("Error loading products:", err);
  }
}

function renderProductsList() {
  const tbody = document.getElementById("products-table-body");
  let items = [...state.products];

  // Фильтры
  const search = document.getElementById("prod-filter-search").value.toLowerCase();
  const category = document.getElementById("prod-filter-category").value;
  const brand = document.getElementById("prod-filter-brand").value;
  const stock = document.getElementById("prod-filter-stock").value;
  const sort = document.getElementById("prod-sort").value;

  if (search) {
    items = items.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(search) ||
        (p.brand || "").toLowerCase().includes(search) ||
        (p.category || "").toLowerCase().includes(search)
    );
  }
  if (category) {
    items = items.filter((p) => p.category === category);
  }
  if (brand) {
    items = items.filter((p) => p.brand === brand);
  }
  if (stock === "in_stock") {
    items = items.filter((p) => p.in_stock);
  } else if (stock === "out_stock") {
    items = items.filter((p) => !p.in_stock);
  }

  // Сортировка
  if (sort === "priority_asc") {
    items.sort((a, b) => (a.priority || 0) - (b.priority || 0) || a.id - b.id);
  } else if (sort === "price_asc") {
    items.sort((a, b) => a.price - b.price);
  } else if (sort === "price_desc") {
    items.sort((a, b) => b.price - a.price);
  } else if (sort === "name_asc") {
    items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--text-dim);">Товары не найдены</td></tr>`;
    return;
  }

  tbody.innerHTML = items
    .map((p) => {
      const uzs = Math.round(p.price * config.usdRate).toLocaleString("ru-RU");
      const photoHtml =
        p.photo_url && p.photo_url.startsWith("http")
          ? `<img src="${p.photo_url}" class="prod-thumb" alt="${escapeHtml(p.name)}">`
          : `<div class="prod-thumb">📦</div>`;

      return `
      <tr>
        <td>
          <span class="priority-badge" title="Позиция по счету в боте">#${p.priority || 0}</span>
        </td>
        <td>${photoHtml}</td>
        <td>
          <div class="prod-name-cell">${escapeHtml(p.name)}</div>
          <div class="prod-sub">ID: ${p.id} ${p.description ? "• " + escapeHtml(p.description.slice(0, 45)) : ""}</div>
        </td>
        <td>
          <span class="badge-brand">${escapeHtml(p.brand || "—")}</span>
        </td>
        <td>
          <span class="badge-category">${escapeHtml(p.category)}</span>
        </td>
        <td>
          <div class="price-main">$${p.price}</div>
          <div class="price-uzs">≈ ${uzs} сум</div>
        </td>
        <td>
          <label class="switch-container">
            <input type="checkbox" ${p.in_stock ? "checked" : ""} onchange="toggleProductStock(${p.id}, this.checked)">
            <span class="switch-slider"></span>
          </label>
        </td>
        <td style="text-align: right;">
          <div class="table-actions">
            <button class="btn-action-icon" title="Редактировать" onclick="openEditProductModal(${p.id})">
              ✏️
            </button>
            <button class="btn-action-icon danger" title="Удалить" onclick="deleteProduct(${p.id})">
              🗑
            </button>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
}

function populateProductFilters() {
  const catSelect = document.getElementById("prod-filter-category");
  const brandSelect = document.getElementById("prod-filter-brand");

  const categories = [...new Set(state.products.map((p) => p.category).filter(Boolean))].sort();
  const brands = [...new Set(state.products.map((p) => p.brand).filter(Boolean))].sort();

  catSelect.innerHTML = '<option value="">Все категории</option>' + categories.map((c) => `<option value="${c}">${c}</option>`).join("");
  brandSelect.innerHTML = '<option value="">Все бренды</option>' + brands.map((b) => `<option value="${b}">${b}</option>`).join("");
}

// Быстрое переключение наличия в 1 клик
window.toggleProductStock = async function (id, inStock) {
  try {
    await supabase.from("products").update({ in_stock: inStock }).eq("id", id);
    const prod = state.products.find((p) => p.id === id);
    if (prod) prod.in_stock = inStock;
    showToast(`Товар ${inStock ? "в наличии" : "снят с наличия"}`, "info");
  } catch (err) {
    console.error("Stock error:", err);
  }
};

// Открытие модалки добавления товара (ТРЕБОВАНИЕ 4)
window.openAddProductModal = function () {
  document.getElementById("modal-product-title").textContent = "➕ Добавить новый товар";
  document.getElementById("p-form-id").value = "";
  document.getElementById("p-form-name").value = "";
  document.getElementById("p-form-brand").value = "";
  document.getElementById("p-form-category").value = "";
  document.getElementById("p-form-price").value = "";
  document.getElementById("p-form-priority").value = "1";
  document.getElementById("p-form-instock").checked = true;
  document.getElementById("p-form-photo").value = "";
  document.getElementById("p-form-desc").value = "";
  document.getElementById("p-form-price-uzs").textContent = "≈ 0 сум";

  document.getElementById("modal-product").style.display = "flex";
};

// Открытие модалки редактирования товара
window.openEditProductModal = function (id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;

  document.getElementById("modal-product-title").textContent = "✏️ Редактировать товар";
  document.getElementById("p-form-id").value = p.id;
  document.getElementById("p-form-name").value = p.name || "";
  document.getElementById("p-form-brand").value = p.brand || "";
  document.getElementById("p-form-category").value = p.category || "";
  document.getElementById("p-form-price").value = p.price;
  document.getElementById("p-form-priority").value = p.priority || 0;
  document.getElementById("p-form-instock").checked = Boolean(p.in_stock);
  document.getElementById("p-form-photo").value = p.photo_url || "";
  document.getElementById("p-form-desc").value = p.description || "";

  const uzs = Math.round(p.price * config.usdRate).toLocaleString("ru-RU");
  document.getElementById("p-form-price-uzs").textContent = `≈ ${uzs} сум`;

  document.getElementById("modal-product").style.display = "flex";
};

// Сохранение товара (Добавление / Изменение) — ТРЕБОВАНИЕ 4
async function handleProductFormSubmit(e) {
  e.preventDefault();

  const idStr = document.getElementById("p-form-id").value;
  const name = document.getElementById("p-form-name").value.trim();
  const brand = document.getElementById("p-form-brand").value.trim() || null;
  const category = document.getElementById("p-form-category").value.trim();
  const price = parseFloat(document.getElementById("p-form-price").value);
  const priority = parseInt(document.getElementById("p-form-priority").value || "0", 10);
  const inStock = document.getElementById("p-form-instock").checked;
  const photoUrl = document.getElementById("p-form-photo").value.trim() || null;
  const description = document.getElementById("p-form-desc").value.trim() || null;

  try {
    if (idStr) {
      // Обновление существующего товара
      const id = parseInt(idStr, 10);
      const { error } = await supabase
        .from("products")
        .update({
          name,
          brand,
          category,
          price,
          priority,
          in_stock: inStock,
          photo_url: photoUrl,
          description,
        })
        .eq("id", id);

      if (error) throw error;
      showToast("✅ Товар успешно обновлен!", "success");
    } else {
      // Добавление нового товара
      const { data, error } = await supabase
        .from("products")
        .insert({
          name,
          brand,
          category,
          price,
          priority,
          in_stock: inStock,
          photo_url: photoUrl,
          description,
        })
        .select()
        .single();

      if (error) {
        // Попытка через хранимую функцию
        await supabase.rpc("admin_save_product", {
          p_id: null,
          p_name: name,
          p_brand: brand,
          p_category: category,
          p_price: price,
          p_priority: priority,
          p_in_stock: inStock,
          p_photo_url: photoUrl,
          p_description: description,
        });
      }
      showToast("🎉 Новый товар успешно добавлен в бота!", "success");
    }

    document.getElementById("modal-product").style.display = "none";
    await loadProducts();
    updateKpiMetrics();
  } catch (err) {
    console.error("Save product error:", err);
    showToast(`Ошибка сохранения: ${err.message}`, "error");
  }
}

// Удаление товара
window.deleteProduct = async function (id) {
  const p = state.products.find((x) => x.id === id);
  if (!confirm(`Удалить товар «${p ? p.name : id}» из каталога?`)) return;

  try {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      await supabase.rpc("admin_delete_product", { p_id: id });
    }

    state.products = state.products.filter((x) => x.id !== id);
    renderProductsList();
    updateKpiMetrics();
    showToast("🗑 Товар удален.", "info");
  } catch (err) {
    console.error("Delete product error:", err);
    showToast(`Ошибка удаления: ${err.message}`, "error");
  }
};

// ============================================================================
//  3. УПРАВЛЕНИЕ ЗАКАЗАМИ
// ============================================================================
async function loadOrders() {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    state.orders = data || [];
    renderOrdersList();
  } catch (err) {
    console.error("Error loading orders:", err);
  }
}

function renderOrdersList() {
  const container = document.getElementById("orders-grid-container");
  const newCountBadge = document.getElementById("orders-count-new");
  const totalCountBadge = document.getElementById("orders-count-total");

  const newOrders = state.orders.filter((o) => o.status === "новый");
  newCountBadge.textContent = `Новые: ${newOrders.length}`;
  totalCountBadge.textContent = `Всего: ${state.orders.length}`;

  if (state.orders.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align:center; padding:60px; color:var(--text-dim);">
        📦 Заказов пока нет.<br>Когда клиент нажмет «Оформить заказ» в боте, заказ появится здесь!
      </div>`;
    return;
  }

  container.innerHTML = state.orders
    .map((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      const itemsHtml = items
        .map(
          (it) => `
        <div class="order-item-row">
          <span>${escapeHtml(it.name || "Товар")} × ${it.qty || 1}</span>
          <b>$${(it.price || 0) * (it.qty || 1)}</b>
        </div>
      `
        )
        .join("");

      return `
      <div class="order-card">
        <div class="order-card-header">
          <span class="order-id">#${escapeHtml(o.order_id)}</span>
          <span class="order-time">${formatDate(o.created_at)}</span>
        </div>

        <div class="order-client-info">
          <div><b>👤 Клиент:</b> ${escapeHtml(o.customer_name || "Покупатель")} ${o.username ? `(@${o.username})` : ""}</div>
          <div><b>📱 Телефон:</b> ${escapeHtml(o.phone || "Не указан")}</div>
          <div><b>📍 Доставка:</b> ${escapeHtml(o.delivery_type || "—")} (${escapeHtml(o.delivery_address || "")})</div>
        </div>

        <div class="order-items-list">
          ${itemsHtml || '<div style="color:var(--text-dim);">Товары не указаны</div>'}
        </div>

        <div class="order-total-row">
          <span style="font-size:12px; color:var(--text-muted);">Итого:</span>
          <div class="order-total-amount">$${o.total_usd} <small style="font-size:12px; color:var(--color-green);">(≈ ${(o.total_uzs || 0).toLocaleString("ru-RU")} сум)</small></div>
        </div>

        <div class="order-actions-row">
          <select class="order-status-select" onchange="updateOrderStatus('${o.order_id}', this.value)">
            <option value="новый" ${o.status === "новый" ? "selected" : ""}>🟡 Новый заказ</option>
            <option value="принят" ${o.status === "принят" ? "selected" : ""}>🔵 Принят в работу</option>
            <option value="доставка" ${o.status === "доставка" ? "selected" : ""}>🟣 Передан курьеру</option>
            <option value="выполнен" ${o.status === "выполнен" ? "selected" : ""}>🟢 Выполнен</option>
            <option value="отменен" ${o.status === "отменен" ? "selected" : ""}>🔴 Отменен</option>
          </select>
          <button class="btn-action-icon" title="Написать клиенту в чат" onclick="goToChatWithUser(${o.telegram_id})">
            💬
          </button>
        </div>
      </div>
    `;
    })
    .join("");
}

window.updateOrderStatus = async function (orderId, newStatus) {
  try {
    await supabase.from("orders").update({ status: newStatus }).eq("order_id", orderId);
    showToast(`Статус заказа #${orderId} изменен на «${newStatus}»`, "info");
  } catch (err) {
    console.error("Order status error:", err);
  }
};

window.goToChatWithUser = function (telegramId) {
  switchToTab("tab-chat");
  selectUser(telegramId);
};

// ============================================================================
//  4. МАССОВАЯ РАССЫЛКА (BROADCAST)
// ============================================================================
async function startBroadcast() {
  const text = document.getElementById("broadcast-text").value.trim();
  const photoUrl = document.getElementById("broadcast-photo-url").value.trim();

  if (!text) {
    alert("Пожалуйста, введите текст рассылки!");
    return;
  }

  const activeUsers = state.users.filter((u) => !u.is_blocked);
  if (activeUsers.length === 0) {
    alert("Нет активных пользователей для рассылки.");
    return;
  }

  if (!confirm(`Отправить рассылку ${activeUsers.length} клиентам бота?`)) return;

  const progressBox = document.getElementById("broadcast-progress-box");
  const progressFill = document.getElementById("broadcast-progress-fill");
  const progressText = document.getElementById("broadcast-progress-text");

  progressBox.style.display = "block";
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < activeUsers.length; i++) {
    const u = activeUsers[i];
    try {
      if (photoUrl) {
        await fetch(`https://api.telegram.org/bot${config.botToken}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: u.telegram_id,
            photo: photoUrl,
            caption: text,
          }),
        });
      } else {
        await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: u.telegram_id,
            text: text,
          }),
        });
      }
      sent++;
    } catch (e) {
      failed++;
    }

    const pct = Math.round(((i + 1) / activeUsers.length) * 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `Отправлено: ${sent} | Ошибок: ${failed} (Всего: ${activeUsers.length})`;
    await new Promise((r) => setTimeout(r, 60)); // Защита от лимитов Telegram
  }

  showToast(`🎉 Рассылка завершена! Доставлено: ${sent}`, "success");
}

// ============================================================================
//  5. WEBHOOK И НАСТРОЙКИ СЕРВЕРА
// ============================================================================
async function checkWebhookStatus() {
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/getWebhookInfo`);
    const data = await res.json();

    if (data.ok) {
      state.webhookInfo = data.result;
      const urlSpan = document.getElementById("wb-current-url");
      const pendingSpan = document.getElementById("wb-pending-count");
      const errorSpan = document.getElementById("wb-last-error");
      const badgeText = document.getElementById("webhook-status-text");

      const currentUrl = data.result.url || "";
      urlSpan.textContent = currentUrl || "Не установлен (Режим Polling)";
      pendingSpan.textContent = data.result.pending_update_count || 0;

      if (data.result.last_error_message) {
        errorSpan.textContent = `⚠️ ${data.result.last_error_message} (${formatDate(new Date(data.result.last_error_date * 1000))})`;
        errorSpan.style.color = "var(--color-rose)";
      } else {
        errorSpan.textContent = "Ошибок нет ✅";
        errorSpan.style.color = "var(--color-green)";
      }

      if (currentUrl.includes("supabase.co")) {
        badgeText.textContent = "🟢 Webhook 24/7 Активен";
      } else if (currentUrl) {
        badgeText.textContent = "🟡 Webhook: " + currentUrl.slice(0, 20) + "...";
      } else {
        badgeText.textContent = "⚪ Webhook отключен (ПК/Polling)";
      }
    }
  } catch (err) {
    console.error("Webhook check error:", err);
  }
}

// Установка вебхука на Supabase
async function setWebhookToSupabase() {
  const edgeFunctionUrl = `${config.supabaseUrl}/functions/v1/telegram-bot`;
  showToast("Установка Webhook на Supabase...", "info");

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: edgeFunctionUrl,
        allowed_updates: ["message", "callback_query"],
      }),
    });
    const result = await res.json();

    if (result.ok) {
      showToast("🚀 Webhook успешно подключен к Supabase 24/7!", "success");
      await checkWebhookStatus();
    } else {
      throw new Error(result.description);
    }
  } catch (err) {
    console.error("Set webhook error:", err);
    showToast(`Ошибка: ${err.message}`, "error");
  }
}

// Отключение вебхука
async function deleteWebhook() {
  if (!confirm("Отключить Webhook? Бот перейдет в режим ожидания локального запуска python.")) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/deleteWebhook`);
    const result = await res.json();
    if (result.ok) {
      showToast("🔌 Webhook отключен! Теперь можно запускать python bot.py", "info");
      await checkWebhookStatus();
    }
  } catch (err) {
    console.error("Delete webhook error:", err);
  }
}

// Сохранение настроек в localStorage
function saveApiConfig() {
  const token = document.getElementById("cfg-bot-token").value.trim();
  const url = document.getElementById("cfg-supabase-url").value.trim();
  const key = document.getElementById("cfg-supabase-key").value.trim();
  const rate = parseFloat(document.getElementById("cfg-usd-rate").value);

  localStorage.setItem("ac_bot_token", token);
  localStorage.setItem("ac_sb_url", url);
  localStorage.setItem("ac_sb_key", key);
  localStorage.setItem("ac_usd_rate", rate);

  config.botToken = token;
  config.supabaseUrl = url;
  config.supabaseKey = key;
  config.usdRate = rate;

  supabase = window.supabase.createClient(url, key);
  showToast("💾 Настройки успешно сохранены!", "success");
  refreshAll();
  checkWebhookStatus();
}

function loadConfigToInputs() {
  document.getElementById("cfg-bot-token").value = config.botToken;
  document.getElementById("cfg-supabase-url").value = config.supabaseUrl;
  document.getElementById("cfg-supabase-key").value = config.supabaseKey;
  document.getElementById("cfg-usd-rate").value = config.usdRate;
}

// ============================================================================
//  REALTIME ПОДПИСКИ SUPABASE
// ============================================================================
function setupRealtimeSubscriptions() {
  if (!supabase) return;

  try {
    // Живые сообщения в чате
    supabase
      .channel("public:bot_messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bot_messages" },
        (payload) => {
          const newMsg = payload.new;
          if (state.activeUser && newMsg.telegram_id === state.activeUser.telegram_id) {
            state.activeMessages.push(newMsg);
            renderMessages();
          } else {
            // Уведомление о новом сообщении от другого пользователя
            showToast(`💬 Новое сообщение от клиента #${newMsg.telegram_id}`, "info");
            loadUsers();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bot_messages" },
        (payload) => {
          const updated = payload.new;
          if (state.activeUser && updated.telegram_id === state.activeUser.telegram_id) {
            const idx = state.activeMessages.findIndex((m) => m.id === updated.id);
            if (idx !== -1) {
              if (updated.is_deleted) {
                state.activeMessages.splice(idx, 1);
              } else {
                state.activeMessages[idx] = updated;
              }
              renderMessages(true);
            }
          }
        }
      )
      .subscribe();

    // Живые заказы
    supabase
      .channel("public:orders")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          showToast(`🔔 НОВЫЙ ЗАКАЗ #${payload.new.order_id} на $${payload.new.total_usd}!`, "success");
          loadOrders();
          updateKpiMetrics();
        }
      )
      .subscribe();
  } catch (err) {
    console.warn("Realtime subscription notice:", err);
  }
}

// ============================================================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И СЛУШАТЕЛИ
// ============================================================================
function initEventListeners() {
  // Кнопка отправки сообщения в чате
  document.getElementById("btn-send-message").addEventListener("click", sendAdminMessage);
  document.getElementById("chat-message-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAdminMessage();
    }
  });

  // Кнопка блокировки пользователя
  document.getElementById("btn-toggle-block").addEventListener("click", toggleActiveUserBlock);

  // Быстрые ответы в чате
  document.querySelectorAll(".quick-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const msg = chip.getAttribute("data-msg");
      document.getElementById("chat-message-input").value = msg;
      document.getElementById("chat-message-input").focus();
    });
  });

  // Поиск пользователей
  document.getElementById("user-search-input").addEventListener("input", (e) => {
    state.searchUsers = e.target.value.trim();
    renderUsersList();
  });

  // Фильтр пользователей (Все / Активные / Блок)
  document.querySelectorAll(".pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pill-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.filterUsers = btn.getAttribute("data-filter");
      renderUsersList();
    });
  });

  // Модалка добавления товара
  document.getElementById("btn-open-add-product").addEventListener("click", openAddProductModal);
  document.getElementById("btn-close-product-modal").addEventListener("click", () => {
    document.getElementById("modal-product").style.display = "none";
  });
  document.getElementById("btn-cancel-product-modal").addEventListener("click", () => {
    document.getElementById("modal-product").style.display = "none";
  });
  document.getElementById("form-product").addEventListener("submit", handleProductFormSubmit);

  // Фильтры товаров
  document.getElementById("prod-filter-search").addEventListener("input", renderProductsList);
  document.getElementById("prod-filter-category").addEventListener("change", renderProductsList);
  document.getElementById("prod-filter-brand").addEventListener("change", renderProductsList);
  document.getElementById("prod-filter-stock").addEventListener("change", renderProductsList);
  document.getElementById("prod-sort").addEventListener("change", renderProductsList);

  // Модалка редактирования сообщения
  document.getElementById("btn-close-edit-modal").addEventListener("click", () => {
    document.getElementById("modal-edit-message").style.display = "none";
  });
  document.getElementById("btn-cancel-edit-modal").addEventListener("click", () => {
    document.getElementById("modal-edit-message").style.display = "none";
  });
  document.getElementById("form-edit-message").addEventListener("submit", handleEditMessageSubmit);

  // Рассылка
  document.getElementById("btn-start-broadcast").addEventListener("click", startBroadcast);
  document.getElementById("broadcast-text").addEventListener("input", (e) => {
    document.getElementById("broadcast-preview-content").textContent = e.target.value || "Текст появится здесь...";
  });

  // Webhook кнопки
  document.getElementById("btn-check-webhook-now").addEventListener("click", checkWebhookStatus);
  document.getElementById("btn-set-webhook-supabase").addEventListener("click", setWebhookToSupabase);
  document.getElementById("btn-delete-webhook").addEventListener("click", deleteWebhook);
  document.getElementById("btn-save-api-config").addEventListener("click", saveApiConfig);

  // Копирование кода Edge Function
  document.getElementById("btn-copy-edge-function-code").addEventListener("click", () => {
    navigator.clipboard.writeText(`// Скопируйте код из файла supabase/functions/telegram-bot/index.ts`);
    showToast("📋 Код скопирован в буфер обмена!", "success");
  });

  // Кнопка общего обновления
  document.getElementById("btn-refresh-all").addEventListener("click", refreshAll);
}

function initFormCalculators() {
  const priceInput = document.getElementById("p-form-price");
  const badge = document.getElementById("p-form-price-uzs");

  priceInput.addEventListener("input", () => {
    const val = parseFloat(priceInput.value) || 0;
    const uzs = Math.round(val * config.usdRate).toLocaleString("ru-RU");
    badge.textContent = `≈ ${uzs} сум`;
  });
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeJs(str) {
  if (!str) return "";
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, " ");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
