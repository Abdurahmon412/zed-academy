const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

function getTelegramUserId() {
  const tgUser = tg?.initDataUnsafe?.user;
  return tgUser && tgUser.id ? String(tgUser.id) : null;
}

function triggerHaptic(type = 'light') {
  try {
    if (tg?.HapticFeedback) {
      if (['success', 'error', 'warning'].includes(type)) {
        tg.HapticFeedback.notificationOccurred(type);
      } else {
        tg.HapticFeedback.impactOccurred(type);
      }
    }
  } catch (_) {}
}

const state = {
  user: JSON.parse(localStorage.getItem('zed_user') || 'null'),
  theme: localStorage.getItem('zed_theme') || (tg?.colorScheme === 'dark' ? 'dark' : 'light'),
  activeTab: 'dashboard',
  users: [],
  groups: [],
  attendance: [],
  homeworks: [],
  payments: [],
  quizzes: [],
  quiz_submissions: [],
  attendanceDraft: {},
  studentSearchQuery: '',
  studentGroupFilter: 'all'
};

let countdownInterval = null;

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('zed_theme', theme);
  try {
    if (tg) {
      const bgColor = theme === 'dark' ? '#0b1120' : '#f4f7fb';
      tg.setBackgroundColor(bgColor);
      tg.setHeaderColor(bgColor);
    }
  } catch (_) {}
  refreshIcons();
}

function toggleTheme() {
  triggerHaptic('light');
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ==================== NEXT LESSON CALCULATOR ====================
function computeNextLessonInfo(scheduleStr) {
  if (!scheduleStr) {
    return { label: 'Schedule TBA', remainingText: 'Ask Instructor' };
  }
  const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const lower = scheduleStr.toLowerCase();

  let targetDays = [];
  Object.keys(dayMap).forEach((k) => {
    if (lower.includes(k)) targetDays.push(dayMap[k]);
  });
  if (targetDays.length === 0) targetDays = [1, 3, 5];

  const timeMatch = scheduleStr.match(/(\d{1,2}):(\d{2})/);
  const hour = timeMatch ? parseInt(timeMatch[1], 10) : 15;
  const minute = timeMatch ? parseInt(timeMatch[2], 10) : 0;

  const now = new Date();
  let bestDate = null;

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);

    if (targetDays.includes(candidate.getDay()) && candidate > now) {
      bestDate = candidate;
      break;
    }
  }

  if (!bestDate) {
    return { label: scheduleStr, remainingText: 'Upcoming' };
  }

  const diffMs = bestDate - now;
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;

  let rem = '';
  if (days > 0) rem += `${days}d `;
  rem += `${hours}h ${mins}m`;

  const isToday = bestDate.toDateString() === now.toDateString();
  const timeFormatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const dayLabel = isToday ? `Today at ${timeFormatted}` : `${dayNames[bestDate.getDay()]}, ${timeFormatted}`;

  return { label: dayLabel, remainingText: rem };
}

// ==================== AUTH MODE SWITCH ====================
const signinPanel = document.getElementById('signin-panel');
const signupPanel = document.getElementById('signup-panel');
const tabSigninBtn = document.getElementById('tab-signin-btn');
const tabSignupBtn = document.getElementById('tab-signup-btn');

async function loadPublicGroupsForSignup() {
  try {
    const { groups } = await apiRequest('/api/public/groups');
    const select = document.getElementById('reg-group');
    if (select) {
      select.innerHTML =
        `<option value="">Choose your study group...</option>` +
        (groups || []).map((g) => `<option value="${g.id}">${g.name} (${g.level})</option>`).join('');
    }
  } catch (_) {}
}

function updateTelegramBanner() {
  const banner = document.getElementById('tg-id-banner');
  const textEl = document.getElementById('tg-id-status-text');
  const tgId = getTelegramUserId();
  const tgUser = tg?.initDataUnsafe?.user;

  if (banner && textEl) {
    if (tgId) {
      banner.classList.remove('warning');
      textEl.textContent = `Telegram ID Verified: #${tgId}`;
      const fullNameInput = document.getElementById('reg-fullname');
      if (fullNameInput && !fullNameInput.value && tgUser) {
        fullNameInput.value = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
      }
    } else {
      banner.classList.add('warning');
      textEl.textContent = 'Open inside Telegram Bot to verify Telegram ID';
    }
  }
}

function switchAuthMode(mode) {
  triggerHaptic('light');
  if (mode === 'signup') {
    signinPanel.style.display = 'none';
    signupPanel.style.display = 'block';
    tabSigninBtn.classList.remove('active');
    tabSignupBtn.classList.add('active');
    updateTelegramBanner();
    loadPublicGroupsForSignup();
  } else {
    signupPanel.style.display = 'none';
    signinPanel.style.display = 'block';
    tabSignupBtn.classList.remove('active');
    tabSigninBtn.classList.add('active');
  }
  refreshIcons();
}

tabSigninBtn?.addEventListener('click', () => switchAuthMode('signin'));
tabSignupBtn?.addEventListener('click', () => switchAuthMode('signup'));
document.getElementById('go-to-signup')?.addEventListener('click', () => switchAuthMode('signup'));
document.getElementById('go-to-signin')?.addEventListener('click', () => switchAuthMode('signin'));

// ==================== PORTAL INITIALIZATION ====================
const authView = document.getElementById('auth-view');
const portalView = document.getElementById('portal-view');

function updateHeaderUI() {
  if (!state.user) return;
  const initial = (state.user.full_name || 'U').trim().charAt(0).toUpperCase();
  document.getElementById('header-avatar').textContent = initial;
  document.getElementById('header-user-name').textContent = state.user.full_name;

  const role = (state.user.role || '').toLowerCase();
  const roleLabels = {
    admin: 'Director / Admin',
    teacher: 'Instructor / Teacher',
    student: 'Student'
  };
  document.getElementById('header-role-text').textContent = roleLabels[role] || 'Member';

  const coinPill = document.getElementById('header-coin-pill');
  const coinCount = document.getElementById('header-coin-count');
  if (coinPill && coinCount) {
    if (role === 'student') {
      coinPill.style.display = 'inline-flex';
      coinCount.textContent = `${state.user.zed_coins || 0} ZED`;
    } else {
      coinPill.style.display = 'none';
    }
  }
}

window.loadBootstrapData = async function () {
  try {
    const data = await apiRequest('/api/bootstrap');
    state.users = data.users || [];
    state.groups = data.groups || [];
    state.attendance = data.attendance || [];
    state.homeworks = data.homeworks || [];
    state.payments = data.payments || [];
    state.quizzes = data.quizzes || [];
    state.quiz_submissions = data.quiz_submissions || [];

    if (state.user) {
      const freshMe = state.users.find((u) => u.id === state.user.id);
      if (freshMe) {
        state.user = { ...state.user, ...freshMe };
        localStorage.setItem('zed_user', JSON.stringify(state.user));
        updateHeaderUI();
      }
    }
    renderActiveTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function enterPortal() {
  authView.classList.remove('active');
  portalView.classList.add('active');
  updateHeaderUI();
  renderNavigationTabs();
  loadBootstrapData();
}

function logout() {
  triggerHaptic('medium');
  if (countdownInterval) clearInterval(countdownInterval);
  state.user = null;
  localStorage.removeItem('zed_user');
  portalView.classList.remove('active');
  authView.classList.add('active');
  switchAuthMode('signin');
  refreshIcons();
}

// Login
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const btn = document.getElementById('login-submit-btn');

  try {
    btn.disabled = true;
    const { user } = await apiRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, telegram_id: getTelegramUserId() })
    });
    state.user = user;
    state.activeTab = 'dashboard';
    localStorage.setItem('zed_user', JSON.stringify(user));
    triggerHaptic('success');
    showToast(`Welcome, ${user.full_name}!`, 'success');
    enterPortal();
  } catch (err) {
    triggerHaptic('error');
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// Student Sign Up
document.getElementById('register-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const tgId = getTelegramUserId();
  if (!tgId) {
    triggerHaptic('error');
    return showToast('Please open this portal inside Telegram Bot to register.', 'error');
  }

  const btn = document.getElementById('register-submit-btn');
  try {
    btn.disabled = true;
    const { user } = await apiRequest('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: document.getElementById('reg-fullname').value.trim(),
        phone: document.getElementById('reg-phone').value.trim(),
        group_id: document.getElementById('reg-group').value,
        username: document.getElementById('reg-username').value.trim(),
        password: document.getElementById('reg-password').value.trim(),
        telegram_id: tgId
      })
    });
    state.user = user;
    state.activeTab = 'dashboard';
    localStorage.setItem('zed_user', JSON.stringify(user));
    triggerHaptic('success');
    showToast('Account registered! Welcome to ZED Academy.', 'success');
    enterPortal();
  } catch (err) {
    triggerHaptic('error');
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('toggle-login-pass')?.addEventListener('click', () => {
  const inp = document.getElementById('login-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});
document.getElementById('toggle-reg-pass')?.addEventListener('click', () => {
  const inp = document.getElementById('reg-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// ==================== OWN PROFILE MODAL ====================
const profileModal = document.getElementById('profile-modal');
document.getElementById('open-profile-modal')?.addEventListener('click', () => {
  if (!state.user) return;
  triggerHaptic('light');
  document.getElementById('prof-fullname').value = state.user.full_name || '';
  document.getElementById('prof-phone').value = state.user.phone || '';
  document.getElementById('prof-username').value = state.user.username || '';
  document.getElementById('prof-current-pass').value = '';
  document.getElementById('prof-new-pass').value = '';
  profileModal.classList.add('open');
  refreshIcons();
});
document.getElementById('close-profile-modal')?.addEventListener('click', () => profileModal.classList.remove('open'));
document.getElementById('cancel-profile-btn')?.addEventListener('click', () => profileModal.classList.remove('open'));

document.getElementById('profile-edit-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await apiRequest('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({
        id: state.user.id,
        full_name: document.getElementById('prof-fullname').value.trim(),
        phone: document.getElementById('prof-phone').value.trim(),
        username: document.getElementById('prof-username').value.trim(),
        current_password: document.getElementById('prof-current-pass').value,
        new_password: document.getElementById('prof-new-pass').value
      })
    });
    state.user = res.user;
    localStorage.setItem('zed_user', JSON.stringify(state.user));
    updateHeaderUI();
    profileModal.classList.remove('open');
    triggerHaptic('success');
    showToast('Profile updated!', 'success');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==================== NAVIGATION TABS ====================
function getTabsForRole(role) {
  const r = (role || 'student').toLowerCase();
  if (r === 'admin') {
    return [
      { id: 'dashboard', label: 'Overview', icon: 'layout-dashboard' },
      { id: 'groups', label: 'Groups', icon: 'layers' },
      { id: 'students', label: 'Students', icon: 'users' },
      { id: 'quiz', label: 'Daily Quiz', icon: 'brain-circuit' },
      { id: 'teachers', label: 'Teachers', icon: 'user-check' },
      { id: 'payments', label: 'Payments', icon: 'credit-card' }
    ];
  }
  if (r === 'teacher') {
    return [
      { id: 'dashboard', label: 'My Groups', icon: 'book-open' },
      { id: 'attendance', label: 'Attendance & Coins', icon: 'calendar-check' },
      { id: 'homework', label: 'Assignments', icon: 'file-text' }
    ];
  }
  return [
    { id: 'dashboard', label: 'My Learning', icon: 'compass' },
    { id: 'homework', label: 'Assignments', icon: 'book-marked' },
    { id: 'payments', label: 'Tuition & Receipts', icon: 'wallet' }
  ];
}

function renderNavigationTabs() {
  const nav = document.getElementById('role-nav-tabs');
  const tabs = getTabsForRole(state.user?.role);
  nav.innerHTML = tabs
    .map(
      (t) => `
      <button type="button" class="tab-btn ${state.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
        <i data-lucide="${t.icon}" class="icon-sm"></i>
        <span>${t.label}</span>
      </button>
    `
    )
    .join('');

  nav.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      triggerHaptic('light');
      state.activeTab = btn.dataset.tab;
      renderNavigationTabs();
      loadBootstrapData();
    });
  });
  refreshIcons();
}

function renderActiveTab() {
  if (countdownInterval) clearInterval(countdownInterval);
  const container = document.getElementById('tab-content-area');
  const role = (state.user?.role || 'student').toLowerCase();

  if (role === 'admin') {
    if (state.activeTab === 'dashboard') renderAdminDashboard(container);
    else if (state.activeTab === 'groups') renderAdminGroups(container);
    else if (state.activeTab === 'students') renderAdminStudents(container);
    else if (state.activeTab === 'quiz') renderAdminQuizzes(container);
    else if (state.activeTab === 'teachers') renderAdminTeachers(container);
    else if (state.activeTab === 'payments') renderAdminPayments(container);
  } else if (role === 'teacher') {
    if (state.activeTab === 'dashboard') renderTeacherDashboard(container);
    else if (state.activeTab === 'attendance') renderTeacherAttendance(container);
    else if (state.activeTab === 'homework') renderTeacherHomework(container);
  } else {
    if (state.activeTab === 'dashboard') renderStudentDashboard(container);
    else if (state.activeTab === 'homework') renderStudentHomework(container);
    else if (state.activeTab === 'payments') renderStudentPayments(container);
  }
  refreshIcons();
}

// ==================== ADMIN: OVERVIEW ====================
function renderAdminDashboard(container) {
  const students = state.users.filter((u) => u.role === 'student');
  const pendingPayments = state.payments.filter((p) => p.status === 'pending');

  container.innerHTML = `
    <div class="stats-grid fade-in-up">
      <div class="stat-card">
        <div><div class="stat-label">Total Students</div><div class="stat-value">${students.length}</div></div>
        <div class="stat-icon-box"><i data-lucide="users"></i></div>
      </div>
      <div class="stat-card">
        <div><div class="stat-label">Active Groups</div><div class="stat-value">${state.groups.length}</div></div>
        <div class="stat-icon-box"><i data-lucide="layers"></i></div>
      </div>
      <div class="stat-card">
        <div><div class="stat-label">Daily Quizzes</div><div class="stat-value">${state.quizzes.length}</div></div>
        <div class="stat-icon-box"><i data-lucide="brain-circuit"></i></div>
      </div>
      <div class="stat-card">
        <div><div class="stat-label">Pending Receipts</div><div class="stat-value">${pendingPayments.length}</div></div>
        <div class="stat-icon-box"><i data-lucide="clock"></i></div>
      </div>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="layers" class="icon-sm"></i><span>Existing Study Groups (${state.groups.length})</span></div>
        <button class="btn btn-ghost" onclick="loadBootstrapData()" style="padding:6px 10px; font-size:0.78rem;">
          <i data-lucide="refresh-cw" class="icon-xs"></i><span>Refresh</span>
        </button>
      </div>
      <div class="item-list">
        ${
          state.groups.length === 0
            ? `<p class="row-sub">No study groups created yet.</p>`
            : state.groups
                .map(
                  (g) => `
              <div class="list-row">
                <div class="row-main">
                  <h4>${g.name} <span class="badge badge-info">${g.level}</span></h4>
                  <div class="row-sub">
                    <span>Instructor: ${g.teacher_name || 'Unassigned'}</span>
                    <span>• ${g.schedule}</span>
                    <span>• ${Number(g.monthly_fee || 0).toLocaleString()} UZS</span>
                  </div>
                </div>
                <div class="att-controls">
                  <span class="badge badge-success">${g.student_count || 0} students</span>
                  <button class="btn btn-ghost" style="padding:7px 10px;" onclick="openEditGroupModal(${g.id})"><i data-lucide="pencil" class="icon-xs"></i></button>
                </div>
              </div>
            `
                )
                .join('')
        }
      </div>
    </div>
  `;
}

// ==================== ADMIN: DAILY QUIZ PANEL ====================
function renderAdminQuizzes(container) {
  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title">
          <i data-lucide="sparkles" class="icon-sm"></i>
          <span>Create Daily Quiz Question (+10 ZED Coins)</span>
        </div>
      </div>
      <form id="create-quiz-form" class="form-stack">
        <div class="input-group">
          <label>Quiz Question</label>
          <div class="input-field-wrap">
            <textarea id="qz-question" placeholder="Write today's question for students..." required></textarea>
          </div>
        </div>
        <div class="input-group">
          <label>Option A</label>
          <div class="input-field-wrap">
            <i data-lucide="circle-dot" class="input-icon"></i>
            <input type="text" id="qz-opt-a" placeholder="Enter Option A" required />
          </div>
        </div>
        <div class="input-group">
          <label>Option B</label>
          <div class="input-field-wrap">
            <i data-lucide="circle-dot" class="input-icon"></i>
            <input type="text" id="qz-opt-b" placeholder="Enter Option B" required />
          </div>
        </div>
        <div class="input-group">
          <label>Option C</label>
          <div class="input-field-wrap">
            <i data-lucide="circle-dot" class="input-icon"></i>
            <input type="text" id="qz-opt-c" placeholder="Enter Option C" required />
          </div>
        </div>
        <div class="stats-grid" style="margin-bottom:0;">
          <div class="input-group">
            <label>Correct Answer</label>
            <div class="input-field-wrap">
              <i data-lucide="check-circle-2" class="input-icon"></i>
              <select id="qz-correct" required>
                <option value="A">Option A is Correct</option>
                <option value="B">Option B is Correct</option>
                <option value="C">Option C is Correct</option>
              </select>
            </div>
          </div>
          <div class="input-group">
            <label>ZED Coin Reward</label>
            <div class="input-field-wrap">
              <i data-lucide="coins" class="input-icon"></i>
              <input type="number" id="qz-coins" value="10" min="1" required />
            </div>
          </div>
        </div>
        <button type="submit" class="btn btn-primary">
          <i data-lucide="send" class="icon-sm"></i>
          <span>Publish Daily Quiz</span>
        </button>
      </form>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="list-checks" class="icon-sm"></i><span>Published Quizzes (${state.quizzes.length})</span></div>
      </div>
      <div class="item-list">
        ${
          state.quizzes.length === 0
            ? `<p class="row-sub">No quizzes published yet.</p>`
            : state.quizzes
                .map(
                  (q) => `
              <div class="list-row">
                <div class="row-main">
                  <h4>${q.question}</h4>
                  <div class="row-sub">
                    <span>A) ${q.option_a}</span>
                    <span>• B) ${q.option_b}</span>
                    <span>• C) ${q.option_c}</span>
                  </div>
                  <div class="row-sub" style="margin-top:5px;">
                    <span class="badge badge-success">Correct: Option ${q.correct_option}</span>
                    <span class="badge badge-gold">+${q.reward_coins} ZED Coins</span>
                    <span class="badge badge-info">${q.correct_answers || 0} / ${q.total_answers || 0} solved</span>
                  </div>
                </div>
                <button class="btn btn-danger-soft" onclick="deleteQuiz(${q.id})" title="Delete Quiz">
                  <i data-lucide="trash-2" class="icon-xs"></i>
                </button>
              </div>
            `
                )
                .join('')
        }
      </div>
    </div>
  `;

  document.getElementById('create-quiz-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/api/quizzes', {
        method: 'POST',
        body: JSON.stringify({
          question: document.getElementById('qz-question').value,
          option_a: document.getElementById('qz-opt-a').value,
          option_b: document.getElementById('qz-opt-b').value,
          option_c: document.getElementById('qz-opt-c').value,
          correct_option: document.getElementById('qz-correct').value,
          reward_coins: document.getElementById('qz-coins').value
        })
      });
      triggerHaptic('success');
      showToast('Daily Quiz published for students!', 'success');
      loadBootstrapData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

window.deleteQuiz = async (id) => {
  try {
    await apiRequest(`/api/quizzes/${id}`, { method: 'DELETE' });
    showToast('Quiz removed', 'info');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ==================== ADMIN: GROUPS ====================
function renderAdminGroups(container) {
  const teachers = state.users.filter((u) => u.role === 'teacher');

  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="layers" class="icon-sm"></i><span>Existing Groups (${state.groups.length})</span></div>
        <button class="btn btn-ghost" onclick="loadBootstrapData()" style="padding:6px 10px; font-size:0.78rem;">
          <i data-lucide="refresh-cw" class="icon-xs"></i><span>Refresh</span>
        </button>
      </div>
      <div class="item-list">
        ${
          state.groups.length === 0
            ? `<p class="row-sub">No groups available. Create one below.</p>`
            : state.groups
                .map(
                  (g) => `
              <div class="list-row">
                <div class="row-main">
                  <h4>${g.name} <span class="badge badge-info">${g.level}</span></h4>
                  <div class="row-sub">
                    <span>Teacher: ${g.teacher_name || 'Unassigned'}</span>
                    <span>• ${g.schedule}</span>
                    <span>• ${Number(g.monthly_fee || 0).toLocaleString()} UZS</span>
                    <span>• <b>${g.student_count || 0} students</b></span>
                  </div>
                </div>
                <div class="att-controls">
                  <button class="btn btn-ghost" style="padding:8px 11px;" onclick="openEditGroupModal(${g.id})">
                    <i data-lucide="pencil" class="icon-xs"></i>
                  </button>
                  <button class="btn btn-danger-soft" onclick="deleteGroup(${g.id})">
                    <i data-lucide="trash-2" class="icon-xs"></i>
                  </button>
                </div>
              </div>
            `
                )
                .join('')
        }
      </div>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="folder-plus" class="icon-sm"></i><span>Create New Group</span></div>
      </div>
      <form id="create-group-form" class="form-stack">
        <div class="input-group">
          <label>Group Name</label>
          <div class="input-field-wrap">
            <i data-lucide="bookmark" class="input-icon"></i>
            <input type="text" id="grp-name" placeholder="e.g., IELTS Intensive B2" required />
          </div>
        </div>
        <div class="input-group">
          <label>Course Level</label>
          <div class="input-field-wrap">
            <i data-lucide="award" class="input-icon"></i>
            <input type="text" id="grp-level" placeholder="e.g., Upper-Intermediate / IELTS" required />
          </div>
        </div>
        <div class="input-group">
          <label>Assign Instructor</label>
          <div class="input-field-wrap">
            <i data-lucide="user-check" class="input-icon"></i>
            <select id="grp-teacher">
              <option value="">Select Instructor...</option>
              ${teachers.map((t) => `<option value="${t.id}">${t.full_name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="input-group">
          <label>Class Schedule (Used for Next Lesson Timer)</label>
          <div class="input-field-wrap">
            <i data-lucide="calendar" class="input-icon"></i>
            <input type="text" id="grp-schedule" value="Mon-Wed-Fri • 15:00" required />
          </div>
        </div>
        <div class="input-group">
          <label>Monthly Tuition Fee (UZS)</label>
          <div class="input-field-wrap">
            <i data-lucide="banknote" class="input-icon"></i>
            <input type="number" id="grp-fee" value="450000" required />
          </div>
        </div>
        <button type="submit" class="btn btn-primary"><i data-lucide="plus" class="icon-sm"></i><span>Create Group</span></button>
      </form>
    </div>
  `;

  document.getElementById('create-group-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/api/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('grp-name').value,
          level: document.getElementById('grp-level').value,
          teacher_id: document.getElementById('grp-teacher').value,
          schedule: document.getElementById('grp-schedule').value,
          monthly_fee: document.getElementById('grp-fee').value
        })
      });
      triggerHaptic('success');
      showToast('Group created!', 'success');
      loadBootstrapData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

const editGroupModal = document.getElementById('edit-group-modal');
window.openEditGroupModal = (groupId) => {
  const grp = state.groups.find((g) => g.id === groupId);
  if (!grp) return;
  triggerHaptic('light');

  const teachers = state.users.filter((u) => u.role === 'teacher');
  const teacherSelect = document.getElementById('edit-grp-teacher');
  teacherSelect.innerHTML =
    `<option value="">Unassigned</option>` +
    teachers.map((t) => `<option value="${t.id}" ${grp.teacher_id === t.id ? 'selected' : ''}>${t.full_name}</option>`).join('');

  document.getElementById('edit-grp-id').value = grp.id;
  document.getElementById('edit-grp-name').value = grp.name || '';
  document.getElementById('edit-grp-level').value = grp.level || '';
  document.getElementById('edit-grp-schedule').value = grp.schedule || '';
  document.getElementById('edit-grp-fee').value = grp.monthly_fee || 450000;

  editGroupModal.classList.add('open');
  refreshIcons();
};

document.getElementById('close-edit-group-modal')?.addEventListener('click', () => editGroupModal.classList.remove('open'));
document.getElementById('cancel-edit-group-btn')?.addEventListener('click', () => editGroupModal.classList.remove('open'));

document.getElementById('edit-group-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-grp-id').value;
  try {
    await apiRequest(`/api/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: document.getElementById('edit-grp-name').value,
        level: document.getElementById('edit-grp-level').value,
        teacher_id: document.getElementById('edit-grp-teacher').value,
        schedule: document.getElementById('edit-grp-schedule').value,
        monthly_fee: document.getElementById('edit-grp-fee').value
      })
    });
    editGroupModal.classList.remove('open');
    triggerHaptic('success');
    showToast('Group updated!', 'success');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

window.deleteGroup = async (id) => {
  try {
    await apiRequest(`/api/groups/${id}`, { method: 'DELETE' });
    showToast('Group deleted', 'info');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ==================== ADMIN: STUDENTS (WITH LIVE SEARCH & GROUP FILTER) ====================
function getFilteredStudentsList() {
  const allStudents = state.users.filter((u) => u.role === 'student');
  const q = (state.studentSearchQuery || '').trim().toLowerCase();
  const grpFilter = state.studentGroupFilter || 'all';

  return allStudents.filter((s) => {
    // Group filter check
    if (grpFilter === 'unassigned' && s.group_id) return false;
    if (grpFilter !== 'all' && grpFilter !== 'unassigned' && String(s.group_id) !== String(grpFilter)) {
      return false;
    }

    // Search query check (name, username, phone, group name, telegram_id)
    if (!q) return true;
    const matchName = (s.full_name || '').toLowerCase().includes(q);
    const matchUser = (s.username || '').toLowerCase().includes(q);
    const matchPhone = (s.phone || '').toLowerCase().includes(q);
    const matchGroup = (s.group_name || '').toLowerCase().includes(q);
    const matchTg = String(s.telegram_id || '').toLowerCase().includes(q);

    return matchName || matchUser || matchPhone || matchGroup || matchTg;
  });
}

function renderStudentRowsHTML() {
  const allStudents = state.users.filter((u) => u.role === 'student');
  const filtered = getFilteredStudentsList();

  const countBadge = document.getElementById('students-Filter-Count');
  if (countBadge) {
    countBadge.textContent =
      filtered.length === allStudents.length
        ? `${allStudents.length} Students`
        : `Showing ${filtered.length} of ${allStudents.length}`;
  }

  if (filtered.length === 0) {
    return `<p class="row-sub" style="padding:12px 4px;">No matching students found. Try clearing the search filter.</p>`;
  }

  return filtered
    .map(
      (s) => `
      <div class="list-row">
        <div class="row-main">
          <h4>${s.full_name} <span class="badge badge-gold">💎 ${s.zed_coins || 0} ZED</span></h4>
          <div class="row-sub">
            <span>@${s.username}</span>
            <span class="badge ${s.group_id ? 'badge-info' : 'badge-warning'}">
              ${s.group_name ? `Group: ${s.group_name}` : 'No Group Assigned'}
            </span>
            <span>• ${s.phone || 'No phone'}</span>
            ${s.telegram_id ? `<span class="badge badge-success">TG #${s.telegram_id}</span>` : ''}
          </div>
        </div>
        <div class="att-controls">
          <button class="btn btn-ghost" style="padding:8px 11px;" onclick="openEditStudentModal(${s.id})" title="Edit Student / Group / Coins">
            <i data-lucide="pencil" class="icon-xs"></i>
          </button>
          <button class="btn btn-danger-soft" onclick="deleteUserAccount(${s.id})">
            <i data-lucide="trash-2" class="icon-xs"></i>
          </button>
        </div>
      </div>
    `
    )
    .join('');
}

function updateStudentsListDOM() {
  const listContainer = document.getElementById('admin-students-list-container');
  if (listContainer) {
    listContainer.innerHTML = renderStudentRowsHTML();
    refreshIcons();
  }
}

function renderAdminStudents(container) {
  const allStudents = state.users.filter((u) => u.role === 'student');

  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title">
          <i data-lucide="users" class="icon-sm"></i>
          <span>Registered Students</span>
          <span class="badge badge-info" id="students-Filter-Count">${allStudents.length} Students</span>
        </div>
        <button class="btn btn-ghost" onclick="loadBootstrapData()" style="padding:6px 10px; font-size:0.78rem;">
          <i data-lucide="refresh-cw" class="icon-xs"></i><span>Refresh</span>
        </button>
      </div>

      <!-- SEARCH & GROUP FILTER BAR -->
      <div class="form-stack" style="margin-bottom: 16px;">
        <div class="input-field-wrap">
          <i data-lucide="search" class="input-icon"></i>
          <input
            type="text"
            id="student-search-input"
            placeholder="Search by student name, @username, phone or group..."
            value="${state.studentSearchQuery}"
            autocomplete="off"
          />
        </div>
        <div class="input-field-wrap">
          <i data-lucide="filter" class="input-icon"></i>
          <select id="student-group-filter">
            <option value="all" ${state.studentGroupFilter === 'all' ? 'selected' : ''}>All Study Groups (${allStudents.length})</option>
            <option value="unassigned" ${state.studentGroupFilter === 'unassigned' ? 'selected' : ''}>Unassigned Students Only</option>
            ${state.groups
              .map(
                (g) =>
                  `<option value="${g.id}" ${String(state.studentGroupFilter) === String(g.id) ? 'selected' : ''}>Group: ${g.name} (${g.level})</option>`
              )
              .join('')}
          </select>
        </div>
      </div>

      <div class="item-list" id="admin-students-list-container">
        ${renderStudentRowsHTML()}
      </div>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="user-plus" class="icon-sm"></i><span>Add New Student & Assign to Group</span></div>
      </div>
      <form id="add-student-form" class="form-stack">
        <div class="input-group">
          <label>Student Full Name</label>
          <div class="input-field-wrap">
            <i data-lucide="user" class="input-icon"></i>
            <input type="text" id="stu-name" placeholder="Full Name" required />
          </div>
        </div>
        <div class="input-group">
          <label>Select Study Group</label>
          <div class="input-field-wrap">
            <i data-lucide="layers" class="input-icon"></i>
            <select id="stu-group" required>
              <option value="">Choose Group...</option>
              ${state.groups.map((g) => `<option value="${g.id}">${g.name} (${g.level})</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="input-group">
          <label>Phone Number</label>
          <div class="input-field-wrap">
            <i data-lucide="phone" class="input-icon"></i>
            <input type="text" id="stu-phone" placeholder="+998 90 123 45 67" />
          </div>
        </div>
        <div class="input-group">
          <label>Username & Password</label>
          <div class="input-field-wrap">
            <i data-lucide="at-sign" class="input-icon"></i>
            <input type="text" id="stu-user" placeholder="Login username" required />
          </div>
        </div>
        <div class="input-group">
          <div class="input-field-wrap">
            <i data-lucide="lock" class="input-icon"></i>
            <input type="text" id="stu-pass" value="student123" required />
          </div>
        </div>
        <button type="submit" class="btn btn-primary"><i data-lucide="plus" class="icon-sm"></i><span>Enroll Student</span></button>
      </form>
    </div>
  `;

  // Live Search Input Listener
  document.getElementById('student-search-input')?.addEventListener('input', (e) => {
    state.studentSearchQuery = e.target.value;
    updateStudentsListDOM();
  });

  // Group Filter Listener
  document.getElementById('student-group-filter')?.addEventListener('change', (e) => {
    state.studentGroupFilter = e.target.value;
    updateStudentsListDOM();
  });

  document.getElementById('add-student-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          full_name: document.getElementById('stu-name').value,
          username: document.getElementById('stu-user').value,
          password: document.getElementById('stu-pass').value,
          phone: document.getElementById('stu-phone').value,
          group_id: document.getElementById('stu-group').value,
          role: 'student'
        })
      });
      triggerHaptic('success');
      showToast('Student enrolled!', 'success');
      loadBootstrapData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

const editStudentModal = document.getElementById('edit-student-modal');
window.openEditStudentModal = (studentId) => {
  const stu = state.users.find((u) => u.id === studentId);
  if (!stu) return;
  triggerHaptic('light');

  const grpSelect = document.getElementById('edit-stu-group');
  grpSelect.innerHTML =
    `<option value="">Unassigned (No Group)</option>` +
    state.groups
      .map((g) => `<option value="${g.id}" ${stu.group_id === g.id ? 'selected' : ''}>${g.name} (${g.level})</option>`)
      .join('');

  document.getElementById('edit-stu-id').value = stu.id;
  document.getElementById('edit-stu-name').value = stu.full_name || '';
  document.getElementById('edit-stu-coins').value = stu.zed_coins || 0;
  document.getElementById('edit-stu-phone').value = stu.phone || '';
  document.getElementById('edit-stu-username').value = stu.username || '';
  document.getElementById('edit-stu-pass').value = '';

  editStudentModal.classList.add('open');
  refreshIcons();
};

document.getElementById('close-edit-student-modal')?.addEventListener('click', () => editStudentModal.classList.remove('open'));
document.getElementById('cancel-edit-student-btn')?.addEventListener('click', () => editStudentModal.classList.remove('open'));

document.getElementById('edit-student-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-stu-id').value;
  try {
    await apiRequest(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        full_name: document.getElementById('edit-stu-name').value,
        group_id: document.getElementById('edit-stu-group').value,
        zed_coins: document.getElementById('edit-stu-coins').value,
        phone: document.getElementById('edit-stu-phone').value,
        username: document.getElementById('edit-stu-username').value,
        password: document.getElementById('edit-stu-pass').value
      })
    });
    editStudentModal.classList.remove('open');
    triggerHaptic('success');
    showToast('Student updated!', 'success');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==================== ADMIN: TEACHERS ====================
function renderAdminTeachers(container) {
  const teachers = state.users.filter((u) => u.role === 'teacher');
  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="briefcase" class="icon-sm"></i><span>Instructors (${teachers.length})</span></div>
      </div>
      <div class="item-list">
        ${teachers
          .map(
            (t) => `
          <div class="list-row">
            <div class="row-main">
              <h4>${t.full_name}</h4>
              <div class="row-sub"><span>@${t.username}</span><span>• ${t.phone || ''}</span></div>
            </div>
            <button class="btn btn-danger-soft" onclick="deleteUserAccount(${t.id})"><i data-lucide="trash-2" class="icon-xs"></i></button>
          </div>
        `
          )
          .join('')}
      </div>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="user-check" class="icon-sm"></i><span>Add New Instructor</span></div>
      </div>
      <form id="add-teacher-form" class="form-stack">
        <div class="input-group">
          <label>Full Name</label>
          <div class="input-field-wrap">
            <i data-lucide="user" class="input-icon"></i>
            <input type="text" id="tch-name" placeholder="e.g., Mr. Sardor" required />
          </div>
        </div>
        <div class="input-group">
          <label>Username & Password</label>
          <div class="input-field-wrap">
            <i data-lucide="at-sign" class="input-icon"></i>
            <input type="text" id="tch-user" placeholder="Username" required />
          </div>
        </div>
        <div class="input-group">
          <div class="input-field-wrap">
            <i data-lucide="lock" class="input-icon"></i>
            <input type="text" id="tch-pass" value="teacher123" required />
          </div>
        </div>
        <div class="input-group">
          <label>Phone Number</label>
          <div class="input-field-wrap">
            <i data-lucide="phone" class="input-icon"></i>
            <input type="text" id="tch-phone" placeholder="+998 90 000 00 00" />
          </div>
        </div>
        <button type="submit" class="btn btn-primary"><i data-lucide="plus" class="icon-sm"></i><span>Add Instructor</span></button>
      </form>
    </div>
  `;

  document.getElementById('add-teacher-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          full_name: document.getElementById('tch-name').value,
          username: document.getElementById('tch-user').value,
          password: document.getElementById('tch-pass').value,
          phone: document.getElementById('tch-phone').value,
          role: 'teacher'
        })
      });
      triggerHaptic('success');
      showToast('Instructor added!', 'success');
      loadBootstrapData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

window.deleteUserAccount = async (id) => {
  try {
    await apiRequest(`/api/users/${id}`, { method: 'DELETE' });
    showToast('Account deleted', 'info');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ==================== ADMIN: PAYMENTS ====================
function renderAdminPayments(container) {
  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="credit-card" class="icon-sm"></i><span>Student Tuition Payments</span></div>
        <button class="btn btn-ghost" onclick="loadBootstrapData()" style="padding:6px 10px; font-size:0.78rem;">
          <i data-lucide="refresh-cw" class="icon-xs"></i><span>Refresh</span>
        </button>
      </div>
      <div class="item-list">
        ${
          state.payments.length === 0
            ? `<p class="row-sub">No payment receipts submitted yet.</p>`
            : state.payments
                .map((p) => {
                  const badgeClass =
                    p.status === 'approved' ? 'badge-success' : p.status === 'rejected' ? 'badge-danger' : 'badge-warning';
                  return `
                <div class="list-row">
                  <div class="row-main">
                    <h4>${p.student_name || 'Student'} — ${Number(p.amount).toLocaleString()} UZS</h4>
                    <div class="row-sub">
                      <span>Month: ${p.month}</span>
                      <span>• Group: ${p.group_name || 'Unassigned'}</span>
                      <span class="badge ${badgeClass}">${p.status}</span>
                    </div>
                  </div>
                  <div class="att-controls">
                    ${
                      p.receipt_image
                        ? `<button class="btn btn-ghost" style="padding:8px 10px;" onclick="previewReceipt(${p.id})" title="View Receipt"><i data-lucide="image" class="icon-xs"></i></button>`
                        : ''
                    }
                    <button class="btn btn-success-soft" onclick="updatePaymentStatus(${p.id}, 'approved')"><i data-lucide="check" class="icon-xs"></i></button>
                    <button class="btn btn-danger-soft" onclick="updatePaymentStatus(${p.id}, 'rejected')"><i data-lucide="x" class="icon-xs"></i></button>
                  </div>
                </div>
              `;
                })
                .join('')
        }
      </div>
    </div>
  `;
}

window.previewReceipt = (paymentId) => {
  const item = state.payments.find((p) => p.id === paymentId);
  if (!item || !item.receipt_image) return;
  document.getElementById('receipt-preview-img').src = item.receipt_image;
  document.getElementById('receipt-modal-meta').textContent = `${item.student_name} • ${item.month} (${Number(item.amount).toLocaleString()} UZS)`;
  document.getElementById('receipt-modal').classList.add('open');
};

document.getElementById('close-receipt-modal')?.addEventListener('click', () => {
  document.getElementById('receipt-modal').classList.remove('open');
});

window.updatePaymentStatus = async (id, status) => {
  try {
    await apiRequest(`/api/payments/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
    triggerHaptic('success');
    showToast(`Payment ${status}`, 'success');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ==================== TEACHER VIEWS ====================
function renderTeacherDashboard(container) {
  const myGroups = state.groups.filter((g) => g.teacher_id === state.user.id);
  const groupsToShow = myGroups.length > 0 ? myGroups : state.groups;

  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="book-open" class="icon-sm"></i><span>My Study Groups</span></div>
      </div>
      <div class="item-list">
        ${groupsToShow
          .map(
            (g) => `
          <div class="list-row">
            <div class="row-main">
              <h4>${g.name} <span class="badge badge-info">${g.level}</span></h4>
              <div class="row-sub"><span>Schedule: ${g.schedule}</span></div>
            </div>
            <span class="badge badge-success">${g.student_count || 0} students</span>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderTeacherAttendance(container) {
  const myGroups = state.groups.filter((g) => g.teacher_id === state.user.id);
  const groupsList = myGroups.length > 0 ? myGroups : state.groups;
  const today = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title">
          <i data-lucide="calendar-check" class="icon-sm"></i>
          <span>Mark Attendance, Homework & Award ZED Coins</span>
        </div>
      </div>
      <div class="form-stack">
        <div class="input-group">
          <label>Select Class Group</label>
          <div class="input-field-wrap">
            <i data-lucide="layers" class="input-icon"></i>
            <select id="att-group-select">
              ${groupsList.map((g) => `<option value="${g.id}">${g.name} (${g.level})</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="input-group">
          <label>Lesson Date</label>
          <div class="input-field-wrap">
            <i data-lucide="calendar" class="input-icon"></i>
            <input type="date" id="att-date-input" value="${today}" />
          </div>
        </div>
        <div id="att-student-list" class="item-list"></div>
        <button type="button" class="btn btn-primary" id="save-att-btn">
          <i data-lucide="sparkles" class="icon-sm"></i>
          <span>Save Attendance & Send ZED Coins</span>
        </button>
      </div>
    </div>
  `;

  const groupSelect = document.getElementById('att-group-select');
  const dateInput = document.getElementById('att-date-input');

  const renderSheet = () => {
    const gid = parseInt(groupSelect.value, 10);
    const selectedDate = dateInput.value;
    const students = state.users.filter((u) => u.role === 'student' && u.group_id === gid);
    const listEl = document.getElementById('att-student-list');

    if (students.length === 0) {
      listEl.innerHTML = `<p class="row-sub">No students assigned to this group yet.</p>`;
      return;
    }

    state.attendanceDraft = {};
    students.forEach((s) => {
      const existingRec = state.attendance.find(
        (a) => a.student_id === s.id && a.group_id === gid && String(a.date).startsWith(selectedDate)
      );
      state.attendanceDraft[s.id] = {
        status: existingRec ? existingRec.status : 'present',
        homework_done: existingRec ? Boolean(existingRec.homework_done) : false,
        coins_awarded: existingRec && existingRec.coins_awarded > 0 ? existingRec.coins_awarded : 10
      };
    });

    listEl.innerHTML = students
      .map((s) => {
        const d = state.attendanceDraft[s.id];
        return `
        <div class="att-student-card" id="att-row-${s.id}">
          <div class="att-top-line">
            <div class="row-main">
              <h4>${s.full_name} <span class="badge badge-gold">💎 ${s.zed_coins || 0} ZED</span></h4>
            </div>
            <div class="att-controls">
              <button type="button" class="att-pill ${d.status === 'present' ? 'active-present' : ''}" onclick="setStudentAtt(${s.id}, 'present')">Present</button>
              <button type="button" class="att-pill ${d.status === 'late' ? 'active-late' : ''}" onclick="setStudentAtt(${s.id}, 'late')">Late</button>
              <button type="button" class="att-pill ${d.status === 'absent' ? 'active-absent' : ''}" onclick="setStudentAtt(${s.id}, 'absent')">Absent</button>
            </div>
          </div>

          <div class="att-bottom-line">
            <button type="button" class="hw-toggle-btn ${d.homework_done ? 'hw-done' : ''}" id="hw-btn-${s.id}" onclick="toggleStudentHw(${s.id})">
              <i data-lucide="${d.homework_done ? 'check-circle-2' : 'circle'}" class="icon-xs"></i>
              <span id="hw-label-${s.id}">${d.homework_done ? 'Homework Done (+Coins)' : 'Homework Not Done'}</span>
            </button>

            <div class="coin-award-input-wrap" id="coin-wrap-${s.id}" style="display: ${d.homework_done ? 'inline-flex' : 'none'};">
              <span>+</span>
              <input type="number" id="coin-inp-${s.id}" value="${d.coins_awarded}" min="1" max="100" onchange="updateStudentCoinDraft(${s.id}, this.value)" />
              <span>ZED Coin</span>
            </div>
          </div>
        </div>
      `;
      })
      .join('');
    refreshIcons();
  };

  groupSelect?.addEventListener('change', renderSheet);
  dateInput?.addEventListener('change', renderSheet);
  if (groupsList.length > 0) renderSheet();

  document.getElementById('save-att-btn')?.addEventListener('click', async () => {
    const gid = parseInt(groupSelect.value, 10);
    const dateVal = dateInput.value;
    const records = Object.entries(state.attendanceDraft).map(([student_id, info]) => ({
      student_id: parseInt(student_id, 10),
      status: info.status,
      homework_done: info.homework_done,
      coins_awarded: info.homework_done ? (parseInt(info.coins_awarded, 10) || 10) : 0
    }));

    try {
      await apiRequest('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({ group_id: gid, date: dateVal, records })
      });
      triggerHaptic('success');
      showToast('Attendance saved & ZED Coins awarded to students!', 'success');
      loadBootstrapData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

window.setStudentAtt = (studentId, status) => {
  triggerHaptic('light');
  if (!state.attendanceDraft[studentId]) return;
  state.attendanceDraft[studentId].status = status;
  const row = document.getElementById(`att-row-${studentId}`);
  if (!row) return;
  row.querySelectorAll('.att-pill').forEach((b) => {
    b.className = 'att-pill';
    if (b.textContent.toLowerCase() === status) b.classList.add(`active-${status}`);
  });
};

window.toggleStudentHw = (studentId) => {
  triggerHaptic('light');
  const item = state.attendanceDraft[studentId];
  if (!item) return;
  item.homework_done = !item.homework_done;

  const btn = document.getElementById(`hw-btn-${studentId}`);
  const label = document.getElementById(`hw-label-${studentId}`);
  const coinWrap = document.getElementById(`coin-wrap-${studentId}`);

  if (item.homework_done) {
    btn.classList.add('hw-done');
    label.textContent = 'Homework Done (+Coins)';
    coinWrap.style.display = 'inline-flex';
  } else {
    btn.classList.remove('hw-done');
    label.textContent = 'Homework Not Done';
    coinWrap.style.display = 'none';
  }
};

window.updateStudentCoinDraft = (studentId, val) => {
  if (!state.attendanceDraft[studentId]) return;
  state.attendanceDraft[studentId].coins_awarded = Math.max(0, parseInt(val, 10) || 0);
};

function renderTeacherHomework(container) {
  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="file-plus-2" class="icon-sm"></i><span>Post New Assignment</span></div>
      </div>
      <form id="post-hw-form" class="form-stack">
        <div class="input-group">
          <label>Target Group</label>
          <div class="input-field-wrap">
            <i data-lucide="layers" class="input-icon"></i>
            <select id="hw-group" required>
              ${state.groups.map((g) => `<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="input-group">
          <label>Assignment Title</label>
          <div class="input-field-wrap">
            <i data-lucide="book-marked" class="input-icon"></i>
            <input type="text" id="hw-title" placeholder="Unit 5 Vocabulary & Essay" required />
          </div>
        </div>
        <div class="input-group">
          <label>Instructions</label>
          <div class="input-field-wrap">
            <textarea id="hw-desc" placeholder="Describe the homework task..."></textarea>
          </div>
        </div>
        <div class="input-group">
          <label>Due Date</label>
          <div class="input-field-wrap">
            <i data-lucide="clock" class="input-icon"></i>
            <input type="text" id="hw-due" placeholder="Friday, 18:00" />
          </div>
        </div>
        <button type="submit" class="btn btn-primary"><i data-lucide="send" class="icon-sm"></i><span>Publish Assignment</span></button>
      </form>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="list-checks" class="icon-sm"></i><span>Published Assignments</span></div>
      </div>
      <div class="item-list">
        ${state.homeworks
          .map(
            (h) => `
          <div class="list-row">
            <div class="row-main">
              <h4>${h.title}</h4>
              <div class="row-sub"><span>Group: ${h.group_name || 'All'}</span><span>• Due: ${h.due_date || 'Next class'}</span></div>
              <p class="row-sub" style="margin-top:4px;">${h.description || ''}</p>
            </div>
            <button class="btn btn-danger-soft" onclick="deleteHw(${h.id})"><i data-lucide="trash-2" class="icon-xs"></i></button>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  document.getElementById('post-hw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/api/homeworks', {
        method: 'POST',
        body: JSON.stringify({
          group_id: document.getElementById('hw-group').value,
          teacher_id: state.user.id,
          title: document.getElementById('hw-title').value,
          description: document.getElementById('hw-desc').value,
          due_date: document.getElementById('hw-due').value
        })
      });
      triggerHaptic('success');
      showToast('Assignment published!', 'success');
      loadBootstrapData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

window.deleteHw = async (id) => {
  try {
    await apiRequest(`/api/homeworks/${id}`, { method: 'DELETE' });
    showToast('Assignment removed', 'info');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ==================== STUDENT DASHBOARD ====================
function renderStudentDashboard(container) {
  const myAtt = state.attendance.filter((a) => a.student_id === state.user.id);
  const presentCount = myAtt.filter((a) => a.status === 'present' || a.status === 'late').length;
  const attRate = myAtt.length > 0 ? Math.round((presentCount / myAtt.length) * 100) : 100;
  const myGroup = state.groups.find((g) => g.id === state.user.group_id);
  const myCoins = state.user.zed_coins || 0;

  const nextInfo = computeNextLessonInfo(myGroup?.schedule || 'Mon-Wed-Fri • 15:00');

  const latestQuiz = state.quizzes[0] || null;
  const mySubmission = latestQuiz
    ? state.quiz_submissions.find((qs) => qs.quiz_id === latestQuiz.id && qs.student_id === state.user.id)
    : null;

  container.innerHTML = `
    <div class="zed-coin-hero fade-in-up">
      <div class="coin-hero-left">
        <div class="coin-tag">
          <i data-lucide="sparkles" class="icon-xs"></i>
          <span>ZED Rewards Balance</span>
        </div>
        <div class="coin-balance-row">
          <span class="coin-amount" id="student-coin-balance">${myCoins}</span>
          <span class="coin-unit">ZED Coins</span>
        </div>
        <div class="coin-ways-hint">
          <span>✨ Homework Done: +Coins</span>
          <span>• 🧠 Daily Quiz: +10 Coins</span>
        </div>
      </div>
      <div class="coin-emblem">
        <i data-lucide="coins" class="icon-lg"></i>
      </div>
    </div>

    <div class="next-lesson-card fade-in-up">
      <div class="next-lesson-info">
        <div class="next-lesson-label">
          <i data-lucide="calendar-clock" class="icon-xs"></i>
          <span>Next Scheduled Lesson</span>
        </div>
        <h3>${nextInfo.label}</h3>
        <div class="next-lesson-meta">
          <span>Group: <b>${myGroup ? myGroup.name : 'Unassigned'}</b></span>
          <span>• Instructor: <b>${myGroup?.teacher_name || 'TBA'}</b></span>
        </div>
      </div>
      <div class="countdown-box">
        <div class="countdown-label">Starts In</div>
        <div class="countdown-timer" id="next-lesson-timer">${nextInfo.remainingText}</div>
      </div>
    </div>

    <div class="quiz-card fade-in-up">
      <div class="section-header">
        <div class="section-title">
          <i data-lucide="brain-circuit" class="icon-sm"></i>
          <span>Daily Quiz Challenge</span>
        </div>
        <span class="badge badge-gold">+${latestQuiz ? latestQuiz.reward_coins : 10} ZED Coins</span>
      </div>
      ${
        !latestQuiz
          ? `<p class="row-sub">No daily quiz posted yet. Check back soon!</p>`
          : `
          <div class="quiz-question-box">${latestQuiz.question}</div>
          <div class="quiz-options-grid">
            ${['A', 'B', 'C']
              .map((letter) => {
                const optText = latestQuiz[`option_${letter.toLowerCase()}`];
                let btnClass = 'quiz-option-btn';
                if (mySubmission) {
                  if (letter === latestQuiz.correct_option) btnClass += ' correct-choice';
                  else if (letter === mySubmission.selected_option && !mySubmission.is_correct) btnClass += ' wrong-choice';
                }
                return `
                  <button type="button" class="${btnClass}" ${mySubmission ? 'disabled' : ''} onclick="submitQuizAnswer(${latestQuiz.id}, '${letter}')">
                    <span class="quiz-opt-letter">${letter}</span>
                    <span>${optText}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
          ${
            mySubmission
              ? `<div style="margin-top:12px;">
                  ${
                    mySubmission.is_correct
                      ? `<span class="badge badge-success">✅ Correct! You earned +${mySubmission.coins_earned} ZED Coins!</span>`
                      : `<span class="badge badge-danger">❌ Incorrect. Correct answer was Option ${latestQuiz.correct_option}.</span>`
                  }
                </div>`
              : ''
          }
        `
      }
    </div>

    <div class="stats-grid fade-in-up">
      <div class="stat-card">
        <div>
          <div class="stat-label">My Group</div>
          <div class="stat-value" style="font-size:1.05rem;">${myGroup ? myGroup.name : 'Unassigned'}</div>
        </div>
        <div class="stat-icon-box"><i data-lucide="graduation-cap"></i></div>
      </div>
      <div class="stat-card">
        <div>
          <div class="stat-label">Attendance Score</div>
          <div class="stat-value">${attRate}%</div>
        </div>
        <div class="stat-icon-box"><i data-lucide="flame"></i></div>
      </div>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="trending-up" class="icon-sm"></i><span>Attendance Progress</span></div>
        <span class="badge badge-success">${presentCount} / ${myAtt.length || 0} Lessons</span>
      </div>
      <div class="progress-wrap">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${attRate}%"></div>
        </div>
      </div>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="calendar-days" class="icon-sm"></i><span>Attendance & Homework Log</span></div>
      </div>
      <div class="item-list">
        ${
          myAtt.length === 0
            ? `<p class="row-sub">No attendance records logged yet.</p>`
            : myAtt
                .map((a) => {
                  const badge =
                    a.status === 'present' ? 'badge-success' : a.status === 'late' ? 'badge-warning' : 'badge-danger';
                  return `
                <div class="list-row">
                  <div class="row-main">
                    <h4>${new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</h4>
                    <div class="row-sub">
                      <span>${a.group_name || ''}</span>
                      <span>• ${a.homework_done ? '✅ Homework Done' : '❌ No Homework'}</span>
                    </div>
                  </div>
                  <div class="att-controls">
                    ${a.coins_awarded > 0 ? `<span class="badge badge-gold">+${a.coins_awarded} ZED</span>` : ''}
                    <span class="badge ${badge}">${a.status}</span>
                  </div>
                </div>
              `;
                })
                .join('')
        }
      </div>
    </div>
  `;
}

window.submitQuizAnswer = async (quizId, optionLetter) => {
  try {
    const res = await apiRequest(`/api/quizzes/${quizId}/answer`, {
      method: 'POST',
      body: JSON.stringify({
        student_id: state.user.id,
        selected_option: optionLetter
      })
    });

    if (res.is_correct) {
      triggerHaptic('success');
      showToast(`🎉 Correct! You earned +${res.coins_earned} ZED Coins!`, 'success');
    } else {
      triggerHaptic('error');
      showToast(`Wrong answer! The correct option was ${res.correct_option}.`, 'error');
    }
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function renderStudentHomework(container) {
  const myHw = state.user.group_id
    ? state.homeworks.filter((h) => h.group_id === state.user.group_id)
    : state.homeworks;

  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="book-marked" class="icon-sm"></i><span>My Assignments</span></div>
      </div>
      <div class="item-list">
        ${
          myHw.length === 0
            ? `<p class="row-sub">No assignments posted for your group yet.</p>`
            : myHw
                .map(
                  (h) => `
              <div class="list-row">
                <div class="row-main">
                  <h4>${h.title}</h4>
                  <div class="row-sub">
                    <span>Instructor: ${h.teacher_name || 'Teacher'}</span>
                    <span>• Due: ${h.due_date || 'Next Lesson'}</span>
                  </div>
                  <p class="row-sub" style="margin-top:6px; color: var(--text-primary);">${h.description || ''}</p>
                </div>
                <span class="badge badge-gold">Complete for +ZED Coins</span>
              </div>
            `
                )
                .join('')
        }
      </div>
    </div>
  `;
}

function compressReceiptImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 800;
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxDim) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else if (h > maxDim) {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };
      img.onerror = () => reject(new Error('Invalid image file'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function renderStudentPayments(container) {
  const myPayments = state.payments.filter((p) => p.student_id === state.user.id);
  const myGroup = state.groups.find((g) => g.id === state.user.group_id);
  const defaultFee = myGroup?.monthly_fee || 450000;

  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="upload-cloud" class="icon-sm"></i><span>Upload Tuition Receipt</span></div>
      </div>
      <form id="student-pay-form" class="form-stack">
        <div class="input-group">
          <label>Amount (UZS)</label>
          <div class="input-field-wrap">
            <i data-lucide="banknote" class="input-icon"></i>
            <input type="number" id="pay-amount" value="${defaultFee}" required />
          </div>
        </div>
        <div class="input-group">
          <label>Payment Month</label>
          <div class="input-field-wrap">
            <i data-lucide="calendar" class="input-icon"></i>
            <input type="text" id="pay-month" value="November 2026" required />
          </div>
        </div>
        <div class="input-group">
          <label>Receipt Screenshot</label>
          <div class="input-field-wrap">
            <i data-lucide="image" class="input-icon"></i>
            <input type="file" id="pay-file" accept="image/*" required />
          </div>
        </div>
        <button type="submit" class="btn btn-primary" id="submit-pay-btn">
          <i data-lucide="send" class="icon-sm"></i>
          <span>Submit Payment Receipt</span>
        </button>
      </form>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="history" class="icon-sm"></i><span>My Payment History</span></div>
      </div>
      <div class="item-list">
        ${
          myPayments.length === 0
            ? `<p class="row-sub">No payments submitted yet.</p>`
            : myPayments
                .map((p) => {
                  const badgeClass =
                    p.status === 'approved' ? 'badge-success' : p.status === 'rejected' ? 'badge-danger' : 'badge-warning';
                  return `
                <div class="list-row">
                  <div class="row-main">
                    <h4>${Number(p.amount).toLocaleString()} UZS</h4>
                    <div class="row-sub"><span>${p.month}</span></div>
                  </div>
                  <span class="badge ${badgeClass}">${p.status}</span>
                </div>
              `;
                })
                .join('')
        }
      </div>
    </div>
  `;

  document.getElementById('student-pay-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('pay-file');
    const btn = document.getElementById('submit-pay-btn');
    if (!fileInput.files || !fileInput.files[0]) {
      return showToast('Please select a receipt image.', 'error');
    }

    try {
      btn.disabled = true;
      btn.innerHTML = `<span>Uploading...</span>`;
      const base64Image = await compressReceiptImage(fileInput.files[0]);

      await apiRequest('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          student_id: state.user.id,
          amount: document.getElementById('pay-amount').value,
          month: document.getElementById('pay-month').value,
          receipt_image: base64Image
        })
      });

      triggerHaptic('success');
      showToast('Receipt uploaded successfully!', 'success');
      fileInput.value = '';
      loadBootstrapData();
    } catch (err) {
      triggerHaptic('error');
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="send" class="icon-sm"></i><span>Submit Payment Receipt</span>`;
      refreshIcons();
    }
  });
}

document.getElementById('auth-theme-toggle')?.addEventListener('click', toggleTheme);
document.getElementById('portal-theme-toggle')?.addEventListener('click', toggleTheme);
document.getElementById('logout-btn')?.addEventListener('click', logout);

applyTheme(state.theme);
if (state.user) {
  enterPortal();
} else {
  refreshIcons();
}
