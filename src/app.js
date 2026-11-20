
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, CREATOR_USERNAME, MODERATION_REPORT_USERNAME } from "./config.js";

const configured = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  profile: null,
  page: "dashboard",
  publicMessages: [],
  activeConversation: null,
  realtime: null,
  settings: {}
};

const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[c]));

const isCreator = () =>
  state.profile?.role === "creator" ||
  state.profile?.username === CREATOR_USERNAME;

const toast = (msg) => {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
};

const dateText = (d) => d ? new Date(d).toLocaleString() : "";
const initials = (name = "") => esc(name.trim().slice(0, 1).toUpperCase() || "?");

// NAVIGATION

function showPage(page) {
  const pageElement = $("page-" + page);
  if (!pageElement) return;

  state.page = page;

  document.querySelectorAll(".page").forEach(p => p.hidden = true);
  pageElement.hidden = false;

  document.querySelectorAll(".nav-button").forEach(b =>
    b.classList.toggle("active", b.dataset.page === page)
  );

  const renderers = {
    dashboard: renderDashboard,
    public: renderPublic,
    messages: renderMessages,
    notifications: renderNotifications,
    announcements: renderAnnouncements,
    profile: renderProfile,
    settings: renderSettings,
    creator: renderCreator
  };

  renderers[page]?.();
}

function showApp() {
  $("auth-view").hidden = true;
  $("main-view").hidden = false;
  $("top-username").textContent = state.profile?.username || "";
  $("creator-nav").hidden = !isCreator();

  showPage("dashboard");
  updateUnread();
}

function showAuth() {
  $("auth-view").hidden = false;
  $("main-view").hidden = true;
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", state.user.id)
    .single();

  if (error) throw error;

  state.profile = data;
  state.settings = data.settings || {};
}

// AUTHENTICATION

async function start() {
  if (!configured) {
    $("auth-error").textContent =
      "Add your Supabase URL and anon key in src/config.js, then refresh.";
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    state.user = session.user;

    try {
      await loadProfile();
      showApp();
      startRealtime();
    } catch (e) {
      toast(e.message);
    }
  } else {
    showAuth();
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      state.user = session.user;

      try {
        await loadProfile();
        showApp();
        startRealtime();
      } catch (e) {
        toast(e.message);
      }
    } else {
      state.user = null;
      state.profile = null;
      showAuth();
    }
  });
}

$("auth-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabase) return;

  const username = $("auth-username").value.trim();
  const password = $("auth-password").value;

  const { data, error } = await supabase.auth.signInWithPassword({
    email: `${username.toLowerCase()}@glowingchat.invalid`,
    password
  });

  if (error) {
    $("auth-error").textContent = error.message;
  } else {
    state.user = data.user;
    await loadProfile();
    showApp();
  }
});

$("signup-button").addEventListener("click", async () => {
  if (!supabase) return;

  const username = $("auth-username").value.trim();
  const password = $("auth-password").value;

  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    $("auth-error").textContent =
      "Use 3–24 letters, numbers or underscores.";
    return;
  }

  if (password.length < 8) {
    $("auth-error").textContent =
      "Password must be at least 8 characters.";
    return;
  }

  const { data, error } = await supabase.auth.signUp({
    email: `${username.toLowerCase()}@glowingchat.invalid`,
    password,
    options: { data: { username } }
  });

  if (error) {
    $("auth-error").textContent = error.message;
    return;
  }

  toast("Account created! Check your email if confirmation is enabled.");

  if (data.session) {
    state.user = data.user;
    await loadProfile();
    showApp();
  }
});

$("logout-button").addEventListener("click", () =>
  supabase?.auth.signOut()
);

document.addEventListener("click", e => {
  const nav = e.target.closest("[data-page]");

  if (nav) {
    showPage(nav.dataset.page);
    return;
  }

  const action = e.target.closest("[data-action]");
  if (action) handleAction(action.dataset.action, action.dataset);
});

// REALTIME

function startRealtime() {
  if (state.realtime) {
    supabase.removeChannel(state.realtime);
  }

  state.realtime = supabase.channel("glowingchat-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      () => {
        if (state.page === "public") loadPublicMessages();
        if (state.page === "messages") renderMessages();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${state.user.id}`
      },
      () => {
        updateUnread();

        if (state.page === "notifications") {
          loadNotifications();
        }
      }
    )
    .subscribe();

  updateUnread();
}

// NOTIFICATIONS

async function updateUnread() {
  if (!state.user) return;

  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", state.user.id)
    .is("read_at", null);

  if (error) {
    console.error("Could not update notification count:", error.message);
    return;
  }

  const badge = $("notification-count");

  if (badge) {
    badge.textContent = count ? String(count) : "";
  }
}

function renderNotifications() {
  $("page-notifications").innerHTML = `
    <section class="card">
      <div class="chat-head">
        <div>
          <h2>Notifications</h2>
          <p class="muted">Your glowingchat updates.</p>
        </div>
        <button class="secondary" data-action="mark-all-notifications-read">
          Mark all as read
        </button>
      </div>

      <div id="notification-list" class="list">
        Loading notifications…
      </div>
    </section>
  `;

  loadNotifications();
}

async function loadNotifications() {
  const host = $("notification-list");
  if (!host || !state.user) return;

  const { data, error } = await supabase
    .from("notifications")
    .select("id,user_id,kind,body,related_id,is_admin_warning,created_at,read_at")
    .eq("user_id", state.user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    host.innerHTML = `<p class="error">${esc(error.message)}</p>`;
    return;
  }

  if (!data?.length) {
    host.innerHTML = `
      <div class="empty">
        You're all caught up! No notifications yet.
      </div>
    `;
    return;
  }

  host.innerHTML = data.map(n => {
    const unread = !n.read_at;
    const warning = n.is_admin_warning;

    return `
      <article class="list-item notification-item"
        style="${warning ? "border-left:4px solid #dc4545;" : ""}">

        <div class="chat-head">
          <div>
            ${
              warning
                ? '<span class="badge" style="background:#dc4545;color:white;">ADMIN WARNING</span>'
                : `<span class="muted">${esc(n.kind || "Notification")}</span>`
            }

            <p>${esc(n.body || "")}</p>

            <small class="muted">${dateText(n.created_at)}</small>
          </div>

          ${
            unread
              ? `<button class="secondary"
                  data-action="read-notification"
                  data-id="${esc(n.id)}">
                  Mark as read
                </button>`
              : '<span class="status">Read</span>'
          }
        </div>
      </article>
    `;
  }).join("");
}

async function markNotificationRead(id) {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", state.user.id)
    .is("read_at", null);

  if (error) {
    toast(error.message);
    return;
  }

  await updateUnread();
  await loadNotifications();
}

async function markAllNotificationsRead() {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", state.user.id)
    .is("read_at", null);

  if (error) {
    toast(error.message);
    return;
  }

  await updateUnread();
  await loadNotifications();
  toast("All notifications marked as read.");
}

// DASHBOARD

function renderDashboard() {
  $("page-dashboard").innerHTML = `
    <section class="hero">
      <h2>Welcome back, ${esc(state.profile.username)}!</h2>
      <p>Your glowingchat home base.</p>
    </section>

    <div class="grid-cards">
      ${dashCard("Public Chat", "Join the community conversation.", "public")}
      ${dashCard("Private Messages", "Open your conversations.", "messages")}
      ${dashCard("Notifications", "Check your notifications.", "notifications")}
      ${dashCard("Announcements", "See what's new.", "announcements")}
      ${dashCard("Your Profile", "View your profile and pinned posts.", "profile")}
    </div>
  `;
}

function dashCard(title, desc, page) {
  return `
    <button class="card" data-page="${page}" style="text-align:left">
      <h3>${title} →</h3>
      <span class="muted">${desc}</span>
    </button>
  `;
}

// PUBLIC CHAT

async function renderPublic() {
  $("page-public").innerHTML = `
    <section class="card chat-card">
      <div class="chat-head">
        <div>
          <h2>Public Chat</h2>
          <span class="muted">One community, one conversation.</span>
        </div>
        <button class="secondary" data-action="refresh-public">Refresh</button>
      </div>

      <div id="public-list" class="chat-list">
        <div class="empty">Loading messages…</div>
      </div>

      <form id="public-compose" class="chat-compose">
        <textarea id="public-text" maxlength="3000"
          placeholder="Write a message…" required></textarea>

        <label class="quiet">
          ＋ Image
          <input id="public-image" type="file" accept="image/*" hidden>
        </label>

        <button class="primary">Send</button>
      </form>
    </section>
  `;

  $("public-compose").addEventListener("submit", sendPublicMessage);
  await loadPublicMessages();
}

async function loadPublicMessages() {
  const list = $("public-list");
  if (!list) return;

  const { data, error } = await supabase
    .from("messages")
    .select("id,body,created_at,user_id,profiles!messages_user_id_fkey(username,avatar_url,role)")
    .eq("room", "public")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    list.innerHTML = `<p class="error">${esc(error.message)}</p>`;
    return;
  }

  state.publicMessages = data || [];

  list.innerHTML =
    state.publicMessages.map(m => messageHTML(m)).join("") ||
    `<div class="empty">No messages yet. Start the conversation!</div>`;

  list.scrollTop = list.scrollHeight;
}

function messageHTML(m) {
  const p = m.profiles || {};

  return `
    <article class="message" id="msg-${m.id}">
      <div class="avatar">
        ${p.avatar_url
          ? `<img src="${esc(p.avatar_url)}" alt="">`
          : initials(p.username)}
      </div>

      <div>
        <div class="message-meta">
          <strong>${esc(p.username || "User")}</strong>
          ${p.role === "creator" ? '<span class="badge">Creator</span>' : ""}
          <span class="status">${dateText(m.created_at)}</span>
        </div>

        <div class="message-body">${esc(m.body || "")}</div>

        <div class="message-tools">
          <button data-action="reply" data-id="${m.id}"
            data-user="${esc(p.username || "User")}">Reply</button>

          <button data-action="report-message"
            data-id="${m.id}">Report</button>

          <button data-action="message-menu"
            data-id="${m.id}">⋯</button>
        </div>
      </div>
    </article>
  `;
}

async function sendPublicMessage(e) {
  e.preventDefault();

  const body = $("public-text").value.trim();
  const file = $("public-image").files[0];

  if (!body && !file) return;

  const { data, error } = await supabase
    .from("messages")
    .insert({
      user_id: state.user.id,
      room: "public",
      body
    })
    .select()
    .single();

  if (error) {
    toast(error.message);
    return;
  }

  if (file) await uploadMessageImage(data.id, file);

  $("public-text").value = "";
  $("public-image").value = "";

  await loadPublicMessages();
}

async function uploadMessageImage(messageId, file) {
  if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
    toast("Choose an image under 8 MB.");
    return;
  }

  const path =
    `${state.user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const { error } = await supabase
    .storage
    .from("message-images")
    .upload(path, file, { upsert: false });

  if (error) {
    toast(error.message);
    return;
  }

  const { error: rowError } = await supabase
    .from("message_attachments")
    .insert({
      message_id: messageId,
      storage_path: path
    });

  if (rowError) toast(rowError.message);
}

// PRIVATE MESSAGES

function renderMessages() {
  $("page-messages").innerHTML = `
    <div class="card">
      <h2>Private Messages</h2>
      <p class="muted">
        Start a conversation from someone's profile.
        Existing conversations appear here.
      </p>
      <div id="conversation-list" class="list">Loading conversations…</div>
      <div id="conversation-thread"></div>
    </div>
  `;

  loadConversations();
}

async function loadConversations() {
  const list = $("conversation-list");
  if (!list) return;

  const { data, error } = await supabase
    .from("conversation_members")
    .select("conversation_id,conversations(id,updated_at)")
    .eq("user_id", state.user.id);

  if (error) {
    list.textContent = error.message;
    return;
  }

  if (!data?.length) {
    list.innerHTML = '<div class="empty">No private conversations yet.</div>';
    return;
  }

  list.innerHTML = data.map(c => `
    <button class="list-item" data-action="open-conversation"
      data-id="${c.conversation_id}">
      Conversation · ${dateText(c.conversations?.updated_at)}
    </button>
  `).join("");
}

async function openConversation(id) {
  state.activeConversation = id;

  const host = $("conversation-thread");
  host.innerHTML = '<div class="empty">Loading…</div>';

  const { data, error } = await supabase
    .from("messages")
    .select("id,body,created_at,user_id,profiles(username)")
    .eq("conversation_id", id)
    .order("created_at");

  if (error) {
    host.textContent = error.message;
    return;
  }

  host.innerHTML = `
    <hr class="muted-line">

    <div class="chat-list">
      ${(data || []).map(m => `
        <div class="list-item">
          <b>${esc(m.profiles?.username || "User")}</b>
          <p>${esc(m.body)}</p>
          <small class="muted">${dateText(m.created_at)}</small>
        </div>
      `).join("")}
    </div>

    <form id="dm-compose" class="chat-compose">
      <textarea id="dm-text" required
        placeholder="Write a private message…"></textarea>
      <button class="primary">Send</button>
    </form>
  `;

  $("dm-compose").addEventListener("submit", async e => {
    e.preventDefault();

    const body = $("dm-text").value.trim();
    if (!body) return;

    const { error } = await supabase
      .from("messages")
      .insert({
        user_id: state.user.id,
        conversation_id: id,
        body
      });

    if (error) toast(error.message);
    else openConversation(id);
  });
}

// ANNOUNCEMENTS

function renderAnnouncements() {
  $("page-announcements").innerHTML = `
    <div class="card">
      <h2>Announcements</h2>
      <p class="muted">Updates from METALBEAM.</p>
      <div id="announcement-list" class="list">Loading…</div>
    </div>
  `;

  loadAnnouncements();
}

async function loadAnnouncements() {
  const host = $("announcement-list");

  const { data, error } = await supabase
    .from("announcements")
    .select("*,profiles(username)")
    .order("created_at", { ascending: false });

  if (error) {
    host.textContent = error.message;
    return;
  }

  host.innerHTML = (data || []).map(a => `
    <article class="list-item">
      <span class="announcement-tag">ANNOUNCEMENT</span>
      <h3>${esc(a.title || "Announcement")}</h3>
      <p>${esc(a.body)}</p>
      <small class="muted">${dateText(a.created_at)}</small>
    </article>
  `).join("") || '<div class="empty">No announcements yet.</div>';
}

// PROFILE

function renderProfile() {
  const p = state.profile;

  $("page-profile").innerHTML = `
    <div class="card">
      <div class="profile-head">
        <div class="profile-pic">
          ${p.avatar_url
            ? `<img src="${esc(p.avatar_url)}" alt="">`
            : initials(p.username)}
        </div>

        <div>
          <h2>${esc(p.username)}</h2>
          <span class="status">Joined ${dateText(p.created_at)}</span>
          ${p.original_username
            ? `<p class="muted">Formerly ${esc(p.original_username)}</p>`
            : ""}
        </div>
      </div>

      <hr class="muted-line">
      <h3>BIO</h3>
      <p>${esc(p.bio || "No bio yet.")}</p>

      <h3>Pinned posts</h3>
      <div id="pinned-list" class="list">Loading…</div>

      <button class="secondary" data-action="edit-profile">
        Edit profile
      </button>
    </div>
  `;

  loadPins();
}

async function loadPins() {
  const host = $("pinned-list");

  const { data, error } = await supabase
    .from("pinned_posts")
    .select("message_id,messages(body,created_at)")
    .eq("user_id", state.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    host.textContent = error.message;
    return;
  }

  host.innerHTML = (data || []).map(p => `
    <div class="list-item">${esc(p.messages?.body || "")}</div>
  `).join("") || '<p class="muted">No pinned posts.</p>';
}

// SETTINGS

function renderSettings() {
  const s = state.settings;

  $("page-settings").innerHTML = `
    <div class="card">
      <h2>Settings</h2>

      <div class="field-grid">
        <h3>Privacy</h3>

        <label>
          Online visibility
          <select id="presence-mode">
            <option value="online">Online / Last online</option>
            <option value="dnd">Do not disturb</option>
            <option value="offline">Appear Offline</option>
          </select>
        </label>

        <label>
          Private messages
          <select id="pm-mode">
            <option value="everyone">Everyone</option>
            <option value="creator_only">Everyone except METALBEAM</option>
          </select>
        </label>

        <h3>Account</h3>

        <label>
          Change username
          <input id="new-username" maxlength="24" placeholder="New username">
        </label>

        <button data-action="change-username" class="secondary">
          Save username
        </button>

        <label>
          Current password
          <input id="current-password" type="password" autocomplete="current-password">
        </label>

        <label>
          New password
          <input id="new-password" type="password" minlength="8" autocomplete="new-password">
        </label>

        <button data-action="change-password" class="secondary">
          Change password
        </button>

        <h3>Appearance</h3>

        <label>
          Theme
          <select id="theme-mode">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="neon">Neon</option>
          </select>
        </label>

        <button data-action="save-settings" class="primary">
          Save settings
        </button>

        <h3>Blocked users</h3>
        <div id="blocked-list" class="list">Loading…</div>
      </div>
    </div>
  `;

  $("presence-mode").value = s.presence_mode || "online";
  $("pm-mode").value = s.pm_mode || "everyone";
  $("theme-mode").value = s.theme || "dark";

  document.documentElement.dataset.theme = s.theme || "dark";

  loadBlocked();
}

async function loadBlocked() {
  const host = $("blocked-list");

  const { data, error } = await supabase
    .from("blocks")
    .select("blocked_id,profiles!blocks_blocked_id_fkey(username)")
    .eq("blocker_id", state.user.id);

  if (error) {
    host.textContent = error.message;
    return;
  }

  host.innerHTML = (data || []).map(b => `
    <div class="list-item">
      ${esc(b.profiles?.username || "User")}
      <button data-action="unblock" data-id="${b.blocked_id}">
        Unblock
      </button>
    </div>
  `).join("") || '<p class="muted">No blocked users.</p>';
}

// CREATOR DASHBOARD

function renderCreator() {
  if (!isCreator()) {
    $("page-creator").innerHTML =
      '<div class="card"><h2>Not available</h2></div>';
    return;
  }

  $("page-creator").innerHTML = `
    <div class="hero">
      <h2>Creator Dashboard</h2>
      <p>METALBEAM moderation tools.</p>
    </div>

    <div class="grid-cards">
      <section class="card">
        <h3>Reports</h3>
        <div id="reports-list" class="list">Loading…</div>
      </section>

      <section class="card">
        <h3>Send admin warning</h3>
        <form id="warning-form" class="field-grid">
          <label>Username<input id="warning-username" required></label>
          <label>Warning message<textarea id="warning-body" required></textarea></label>
          <button class="primary">Send warning</button>
        </form>
      </section>
    </div>

    <section class="card">
      <h3>Ban a user</h3>
      <form id="ban-form" class="field-grid">
        <label>Username<input id="ban-username" required></label>

        <label>
          Ban type
          <select id="ban-type">
            <option value="temp">TEMP</option>
            <option value="perm">PERM</option>
          </select>
        </label>

        <label>Reason<textarea id="ban-reason" required></textarea></label>

        <label id="unban-date-wrap">
          Scheduled unban date
          <input id="unban-date" type="datetime-local">
        </label>

        <button class="danger">Issue ban</button>
      </form>
    </section>
  `;

  loadReports();

  $("warning-form").addEventListener("submit", sendWarning);
  $("ban-form").addEventListener("submit", issueBan);

  $("ban-type").addEventListener("change", () => {
    $("unban-date-wrap").hidden = $("ban-type").value === "perm";
  });
}

async function loadReports() {
  const host = $("reports-list");

  const { data, error } = await supabase
    .from("reports")
    .select("*,reporter:profiles!reports_reporter_id_fkey(username),reported:profiles!reports_reported_id_fkey(username)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    host.textContent = error.message;
    return;
  }

  host.innerHTML = (data || []).map(r => `
    <article class="list-item report-card">
      <b>REPORT from ${esc(r.reporter?.username || "Unknown")}</b>
      <p>${esc(r.context || "Reported content")}</p>
      <p>${esc(r.reported?.username || "User")} was reported.</p>
      <button data-action="go-report" data-id="${r.id}">
        Take action
      </button>
    </article>
  `).join("") || '<p class="muted">No pending reports.</p>';
}

// ACTIONS

async function handleAction(action, data) {
  if (action === "refresh-public") loadPublicMessages();

  if (action === "reply") {
    $("public-text").value = `@${data.user} `;
    $("public-text").focus();
  }

  if (action === "report-message") reportMessage(data.id);
  if (action === "message-menu") messageMenu(data.id);
  if (action === "open-conversation") openConversation(data.id);
  if (action === "edit-profile") editProfile();
  if (action === "save-settings") saveSettings();
  if (action === "change-username") changeUsername();
  if (action === "change-password") changePassword();
  if (action === "unblock") unblock(data.id);
  if (action === "go-report") goToReport(data.id);

  if (action === "read-notification") {
    markNotificationRead(data.id);
  }

  if (action === "mark-all-notifications-read") {
    markAllNotificationsRead();
  }
}

// REPORTS

async function reportMessage(id) {
  const m = state.publicMessages.find(x => x.id === id);
  if (!m) return;

  if (m.user_id === state.user.id) {
    toast("You cannot report your own message.");
    return;
  }

  const reason = prompt("Why are you reporting this message?");
  if (!reason) return;

  const { error } = await supabase.from("reports").insert({
    reporter_id: state.user.id,
    reported_user_id: m.user_id,
    message_id: id,
    context: reason,
    report_type: "message"
  });

  toast(error ? error.message : "Report submitted privately.");
}

async function messageMenu(id) {
  const m = state.publicMessages.find(x => x.id === id);
  if (!m) return;

  const choice = prompt("Type: pin, block, report");

  if (choice === "pin" && m.user_id === state.user.id) {
    const { error } = await supabase
      .from("pinned_posts")
      .insert({ user_id: state.user.id, message_id: id });

    toast(error ? error.message : "Post pinned.");
  }

  if (choice === "block") {
    const { error } = await supabase
      .from("blocks")
      .insert({
        blocker_id: state.user.id,
        blocked_id: m.user_id
      });

    toast(error ? error.message : "User blocked.");
  }

  if (choice === "report") reportMessage(id);
}

// PROFILE EDITING

async function editProfile() {
  const bio = prompt("Edit your bio:", state.profile.bio || "");
  if (bio === null) return;

  const { error } = await supabase
    .from("profiles")
    .update({ bio })
    .eq("id", state.user.id);

  if (error) {
    toast(error.message);
  } else {
    state.profile.bio = bio;
    renderProfile();
    toast("Profile updated.");
  }
}

// SETTINGS ACTIONS

async function saveSettings() {
  const settings = {
    ...state.settings,
    presence_mode: $("presence-mode").value,
    pm_mode: $("pm-mode").value,
    theme: $("theme-mode").value
  };

  const { error } = await supabase
    .from("profiles")
    .update({ settings })
    .eq("id", state.user.id);

  if (error) {
    toast(error.message);
  } else {
    state.settings = settings;
    document.documentElement.dataset.theme = settings.theme;
    toast("Settings saved.");
  }
}

async function changeUsername() {
  const username = $("new-username").value.trim();

  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    toast("Username must be 3–24 letters, numbers or underscores.");
    return;
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      username,
      original_username:
        state.profile.original_username || state.profile.username
    })
    .eq("id", state.user.id);

  if (error) {
    toast(error.message);
  } else {
    await loadProfile();
    $("top-username").textContent = username;
    renderSettings();
    toast("Username changed.");
  }
}

async function changePassword() {
  const current = $("current-password").value;
  const next = $("new-password").value;

  if (!current || next.length < 8) {
    toast("Enter your current password and a new password of at least 8 characters.");
    return;
  }

  const email = state.user.email;

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email,
    password: current
  });

  if (verifyError) {
    toast("Current password is incorrect.");
    return;
  }

  const { error } = await supabase.auth.updateUser({ password: next });

  toast(error ? error.message : "Password changed.");
}

async function unblock(id) {
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", state.user.id)
    .eq("blocked_id", id);

  toast(error ? error.message : "User unblocked.");
  loadBlocked();
}

// MODERATION

async function sendWarning(e) {
  e.preventDefault();

  const username = $("warning-username").value.trim();
  const body = $("warning-body").value.trim();

  const { data: user, error: userError } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .single();

  if (userError) {
    toast("User not found.");
    return;
  }

  const { error } = await supabase
    .from("admin_warnings")
    .insert({
      user_id: user.id,
      creator_id: state.user.id,
      body
    });

  toast(error ? error.message : "Admin warning sent.");

  if (!error) e.target.reset();
}

async function issueBan(e) {
  e.preventDefault();

  const username = $("ban-username").value.trim();
  const type = $("ban-type").value;
  const reason = $("ban-reason").value.trim();
  const until = type === "temp" ? $("unban-date").value : null;

  if (type === "temp" && !until) {
    toast("Choose an unban date.");
    return;
  }

  const { data: user, error: userError } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .single();

  if (userError) {
    toast("User not found.");
    return;
  }

  const { error } = await supabase
    .from("bans")
    .insert({
      user_id: user.id,
      creator_id: state.user.id,
      ban_type: type,
      reason,
      unban_at: until ? new Date(until).toISOString() : null
    });

  toast(error ? error.message : "Ban issued.");

  if (!error) e.target.reset();
}

// REPORT NAVIGATION

async function goToReport(id) {
  const { data, error } = await supabase
    .from("reports")
    .select("message_id")
    .eq("id", id)
    .single();

  if (error) {
    toast(error.message);
    return;
  }

  if (data.message_id) {
    showPage("public");

    setTimeout(() => {
      document
        .getElementById(`msg-${data.message_id}`)
        ?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
    }, 250);
  }
}

start();
