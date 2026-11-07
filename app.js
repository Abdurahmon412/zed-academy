const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// Get unique Telegram User ID if opened inside Telegram Mini App
function getTelegramUserId() {
  const tgUser = tg?.initDataUnsafe?.user;
  if (tgUser && tgUser.id) {
    return String(tgUser.id);
  }
  return null;
}

function triggerHaptic(type = 'light') {
  try {
    if (tg?.HapticFeedback) {
      if (type === 'success' || type === 'error' || type === 'warning') {
        tg.HapticFeedback.notificationOccurred(type);
      } else {
        tg.HapticFeedback.impactOccurred(type);
      }
    }
  } catch (_) {}
}

// Global Application State
const state = {
  user: JSON.parse(localStorage.getItem('zed_user') || 'null'),
  theme: localStorage.getItem('zed_theme') || (tg?.colorScheme === 'dark' ? 'dark' : 'light'),
  activeTab: 'dashboard',
  users: [],
  groups: [],
  attendance: [],
  homeworks: [],
  payments: [],
  attendanceDraft: {}
};

// ==================== THEME MANAGEMENT ====================
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
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 3400);
}

// ==================== API HELPER ====================
async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

// ==================== AUTH MODE SWITCH (SIGN IN / SIGN UP) ====================
const signinPanel = document.getElementById('signin-panel');
const signupPanel = document.getElementById('signup-panel');
const tabSigninBtn = document.getElementById('tab-signin-btn');
const tabSignupBtn = document.getElementById('tab-signup-btn');

async function loadPublicGroupsForSignup() {
  try {
    const { groups } = await apiRequest('/api/public/groups');
    const select = document.getElementById('reg-group');
    select.innerHTML =
      `<option value="">Choose your study group...</option>` +
      (groups || []).map((g) => `<option value="${g.id}">${g.name} (${g.level})</option>`).join('');
  } catch (_) {}
}

function updateTelegramBanner() {
  const banner = document.getElementById('tg-id-banner');
  const textEl = document.getElementById('tg-id-status-text');
  const tgId = getTelegramUserId();
  const tgUser = tg?.initDataUnsafe?.user;

  if (tgId) {
    banner.classList.remove('warning');
    textEl.textContent = `Telegram ID Verified: #${tgId} (1 account limit active)`;
    const fullNameInput = document.getElementById('reg-fullname');
    if (!fullNameInput.value && tgUser) {
      fullNameInput.value = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
    }
  } else {
    banner.classList.add('warning');
    textEl.textContent = 'Please open inside Telegram Bot to verify your Telegram ID';
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

tabSigninBtn.addEventListener('click', () => switchAuthMode('signin'));
tabSignupBtn.addEventListener('click', () => switchAuthMode('signup'));
document.getElementById('go-to-signup').addEventListener('click', () => switchAuthMode('signup'));
document.getElementById('go-to-signin').addEventListener('click', () => switchAuthMode('signin'));

// ==================== LOGIN & REGISTRATION SUBMIT ====================
const authView = document.getElementById('auth-view');
const portalView = document.getElementById('portal-view');

function updateHeaderUI() {
  if (!state.user) return;
  const initial = (state.user.full_name || 'U').trim().charAt(0).toUpperCase();
  document.getElementById('header-avatar').textContent = initial;
  document.getElementById('header-user-name').textContent = state.user.full_name;

  const roleLabels = {
    admin: 'Director / Admin',
    teacher: 'Instructor / Teacher',
    student: 'Student'
  };
  document.getElementById('header-role-text').textContent = roleLabels[state.user.role] || 'Member';
}

async function loadBootstrapData() {
  try {
    const data = await apiRequest('/api/bootstrap');
    state.users = data.users || [];
    state.groups = data.groups || [];
    state.attendance = data.attendance || [];
    state.homeworks = data.homeworks || [];
    state.payments = data.payments || [];

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
}

function enterPortal() {
  authView.classList.remove('active');
  portalView.classList.add('active');
  updateHeaderUI();
  renderNavigationTabs();
  loadBootstrapData();
}

function logout() {
  triggerHaptic('medium');
  state.user = null;
  localStorage.removeItem('zed_user');
  portalView.classList.remove('active');
  authView.classList.add('active');
  switchAuthMode('signin');
  refreshIcons();
}

// Login Form
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const btn = document.getElementById('login-submit-btn');

  try {
    btn.disabled = true;
    const { user } = await apiRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        telegram_id: getTelegramUserId()
      })
    });
    state.user = user;
    state.activeTab = 'dashboard';
    localStorage.setItem('zed_user', JSON.stringify(user));
    triggerHaptic('success');
    showToast(`Welcome back, ${user.full_name}!`, 'success');
    enterPortal();
  } catch (err) {
    triggerHaptic('error');
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// Student Self-Registration Form (Enforces 1 Account Per Telegram ID)
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tgId = getTelegramUserId();
  if (!tgId) {
    triggerHaptic('error');
    return showToast('Please open this portal inside the Telegram bot to register with your Telegram ID.', 'error');
  }

  const full_name = document.getElementById('reg-fullname').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const group_id = document.getElementById('reg-group').value;
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value.trim();
  const btn = document.getElementById('register-submit-btn');

  try {
    btn.disabled = true;
    const { user } = await apiRequest('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name,
        phone,
        group_id,
        username,
        password,
        telegram_id: tgId
      })
    });
    state.user = user;
    state.activeTab = 'dashboard';
    localStorage.setItem('zed_user', JSON.stringify(user));
    triggerHaptic('success');
    showToast('Registration complete! Welcome to ZED Academy.', 'success');
    enterPortal();
  } catch (err) {
    triggerHaptic('error');
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// Password Visibility Toggles
document.getElementById('toggle-login-pass').addEventListener('click', () => {
  const input = document.getElementById('login-password');
  input.type = input.type === 'password' ? 'text' : 'password';
});

document.getElementById('toggle-reg-pass').addEventListener('click', () => {
  const input = document.getElementById('reg-password');
  input.type = input.type === 'password' ? 'text' : 'password';
});

// ==================== EDIT PROFILE MODAL (ALL ROLES) ====================
const profileModal = document.getElementById('profile-modal');

function openProfileModal() {
  if (!state.user) return;
  triggerHaptic('light');
  document.getElementById('prof-fullname').value = state.user.full_name || '';
  document.getElementById('prof-phone').value = state.user.phone || '';
  document.getElementById('prof-username').value = state.user.username || '';
  document.getElementById('prof-current-pass').value = '';
  document.getElementById('prof-new-pass').value = '';
  profileModal.classList.add('open');
  refreshIcons();
}

function closeProfileModal() {
  profileModal.classList.remove('open');
}

document.getElementById('open-profile-modal').addEventListener('click', openProfileModal);
document.getElementById('close-profile-modal').addEventListener('click', closeProfileModal);
document.getElementById('cancel-profile-btn').addEventListener('click', closeProfileModal);

document.getElementById('profile-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.user) return;

  const payload = {
    id: state.user.id,
    full_name: document.getElementById('prof-fullname').value.trim(),
    phone: document.getElementById('prof-phone').value.trim(),
    username: document.getElementById('prof-username').value.trim(),
    current_password: document.getElementById('prof-current-pass').value,
    new_password: document.getElementById('prof-new-pass').value
  };

  try {
    const res = await apiRequest('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    state.user = res.user;
    localStorage.setItem('zed_user', JSON.stringify(state.user));
    updateHeaderUI();
    closeProfileModal();
    triggerHaptic('success');
    showToast('Account settings updated successfully!', 'success');
    loadBootstrapData();
  } catch (err) {
    triggerHaptic('error');
    showToast(err.message, 'error');
  }
});

// ==================== NAVIGATION TABS PER ROLE ====================
function getTabsForRole(role) {
  if (role === 'admin') {
    return [
      { id: 'dashboard', label: 'Overview', icon: 'layout-dashboard' },
      { id: 'groups', label: 'Groups', icon: 'layers' },
      { id: 'students', label: 'Students', icon: 'users' },
      { id: 'teachers', label: 'Teachers', icon: 'user-check' },
      { id: 'payments', label: 'Payments', icon: 'credit-card' }
    ];
  }
  if (role === 'teacher') {
    return [
      { id: 'dashboard', label: 'My Groups', icon: 'book-open' },
      { id: 'attendance', label: 'Attendance', icon: 'calendar-check' },
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
  const tabs = getTabsForRole(state.user?.role || 'student');
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
      renderActiveTab();
    });
  });
  refreshIcons();
}

// ==================== RENDER PORTAL CONTENT ====================
function renderActiveTab() {
  const container = document.getElementById('tab-content-area');
  const role = state.user?.role || 'student';

  if (role === 'admin') {
    if (state.activeTab === 'dashboard') renderAdminDashboard(container);
    else if (state.activeTab === 'groups') renderAdminGroups(container);
    else if (state.activeTab === 'students') renderAdminStudents(container);
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

// ---------------- ADMIN VIEWS ----------------
function renderAdminDashboard(container) {
  const students = state.users.filter((u) => u.role === 'student');
  const teachers = state.users.filter((u) => u.role === 'teacher');
  const pendingPayments = state.payments.filter((p) => p.status === 'pending');

  container.innerHTML = `
    <div class="stats-grid fade-in-up">
      <div class="stat-card">
        <div>
          <div class="stat-label">Total Students</div>
          <div class="stat-value">${students.length}</div>
        </div>
        <div class="stat-icon-box"><i data-lucide="users"></i></div>
      </div>
      <div class="stat-card">
        <div>
          <div class="stat-label">Active Groups</div>
          <div class="stat-value">${state.groups.length}</div>
        </div>
        <div class="stat-icon-box"><i data-lucide="layers"></i></div>
      </div>
      <div class="stat-card">
        <div>
          <div class="stat-label">Instructors</div>
          <div class="stat-value">${teachers.length}</div>
        </div>
        <div class="stat-icon-box"><i data-lucide="user-check"></i></div>
      </div>
      <div class="stat-card">
        <div>
          <div class="stat-label">Pending Receipts</div>
          <div class="stat-value">${pendingPayments.length}</div>
        </div>
        <div class="stat-icon-box"><i data-lucide="clock"></i></div>
      </div>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title">
          <i data-lucide="sparkles" class="icon-sm"></i>
          <span>Active Study Groups</span>
        </div>
      </div>
      <div class="item-list">
        ${
          state.groups.length === 0
            ? `<p class="row-sub">No groups created yet.</p>`
            : state.groups
                .map(
                  (g) => `
              <div class="list-row">
                <div class="row-main">
                  <h4>${g.name}</h4>
                  <div class="row-sub">
                    <span>Level: ${g.level || 'General'}</span>
                    <span>• Instructor: ${g.teacher_name || 'Unassigned'}</span>
                    <span>• ${g.schedule || ''}</span>
                  </div>
                </div>
                <span class="badge badge-info">${g.student_count || 0} students</span>
              </div>
            `
                )
                .join('')
        }
      </div>
    </div>
  `;
}

function renderAdminGroups(container) {
  const teachers = state.users.filter((u) => u.role === 'teacher');
  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="folder-plus" class="icon-sm"></i><span>Create New Group</span></div>
      </div>
      <form id="create-group-form" class="form-stack">
        <div class="input-group">
          <label>Group Name</label>
          <div class="input-field-wrap">
            <i data-lucide="bookmark" class="input-icon"></i>
            <input type="text" id="grp-name" placeholder="e.g., IELTS Target 7.0" required />
          </div>
        </div>
        <div class="input-group">
          <label>Course Level</label>
          <div class="input-field-wrap">
            <i data-lucide="award" class="input-icon"></i>
            <input type="text" id="grp-level" placeholder="e.g., Pre-Intermediate / IELTS" required />
          </div>
        </div>
        <div class="input-group">
          <label>Assign Instructor</label>
          <div class="input-field-wrap">
            <i data-lucide="user-check" class="input-icon"></i>
            <select id="grp-teacher">
              <option value="">Select Teacher</option>
              ${teachers.map((t) => `<option value="${t.id}">${t.full_name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="input-group">
          <label>Schedule & Monthly Tuition (UZS)</label>
          <div class="input-field-wrap">
            <i data-lucide="calendar" class="input-icon"></i>
            <input type="text" id="grp-schedule" placeholder="Mon-Wed-Fri 15:00" value="Mon-Wed-Fri • 15:00" />
          </div>
        </div>
        <div class="input-group">
          <div class="input-field-wrap">
            <i data-lucide="banknote" class="input-icon"></i>
            <input type="number" id="grp-fee" placeholder="450000" value="450000" />
          </div>
        </div>
        <button type="submit" class="btn btn-primary"><i data-lucide="plus" class="icon-sm"></i><span>Add Group</span></button>
      </form>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="layers" class="icon-sm"></i><span>All Groups</span></div>
      </div>
      <div class="item-list">
        ${state.groups
          .map(
            (g) => `
          <div class="list-row">
            <div class="row-main">
              <h4>${g.name} (${g.level})</h4>
              <div class="row-sub">
                <span>Teacher: ${g.teacher_name || 'None'}</span>
                <span>• ${g.schedule}</span>
                <span>• ${Number(g.monthly_fee || 0).toLocaleString()} UZS</span>
              </div>
            </div>
            <button class="btn btn-danger-soft" onclick="deleteGroup(${g.id})"><i data-lucide="trash-2" class="icon-xs"></i></button>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  document.getElementById('create-group-form').addEventListener('submit', async (e) => {
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

window.deleteGroup = async (id) => {
  try {
    await apiRequest(`/api/groups/${id}`, { method: 'DELETE' });
    showToast('Group removed', 'info');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function renderAdminStudents(container) {
  const students = state.users.filter((u) => u.role === 'student');
  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="user-plus" class="icon-sm"></i><span>Register Student Manually</span></div>
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
          <label>Username & Password</label>
          <div class="input-field-wrap">
            <i data-lucide="at-sign" class="input-icon"></i>
            <input type="text" id="stu-user" placeholder="Login username" required />
          </div>
        </div>
        <div class="input-group">
          <div class="input-field-wrap">
            <i data-lucide="lock" class="input-icon"></i>
            <input type="text" id="stu-pass" placeholder="Password" value="student123" required />
          </div>
        </div>
        <div class="input-group">
          <label>Phone & Group</label>
          <div class="input-field-wrap">
            <i data-lucide="phone" class="input-icon"></i>
            <input type="text" id="stu-phone" placeholder="+998 90 123 45 67" />
          </div>
        </div>
        <div class="input-group">
          <div class="input-field-wrap">
            <i data-lucide="layers" class="input-icon"></i>
            <select id="stu-group">
              <option value="">Assign to Group</option>
              ${state.groups.map((g) => `<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-primary"><i data-lucide="plus" class="icon-sm"></i><span>Enroll Student</span></button>
      </form>
    </div>

    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="users" class="icon-sm"></i><span>Enrolled Students (${students.length})</span></div>
      </div>
      <div class="item-list">
        ${students
          .map(
            (s) => `
          <div class="list-row">
            <div class="row-main">
              <h4>${s.full_name}</h4>
              <div class="row-sub">
                <span>@${s.username}</span>
                <span>• Group: ${s.group_name || 'Unassigned'}</span>
                <span>• ${s.phone || 'No phone'}</span>
                ${s.telegram_id ? `<span class="badge badge-info">TG: #${s.telegram_id}</span>` : ''}
              </div>
            </div>
            <button class="btn btn-danger-soft" onclick="deleteUserAccount(${s.id})"><i data-lucide="trash-2" class="icon-xs"></i></button>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  document.getElementById('add-student-form').addEventListener('submit', async (e) => {
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

function renderAdminTeachers(container) {
  const teachers = state.users.filter((u) => u.role === 'teacher');
  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="user-check" class="icon-sm"></i><span>Add Instructor</span></div>
      </div>
      <form id="add-teacher-form" class="form-stack">
        <div class="input-group">
          <label>Instructor Full Name</label>
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
  `;

  document.getElementById('add-teacher-form').addEventListener('submit', async (e) => {
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
    showToast('Account removed', 'info');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function renderAdminPayments(container) {
  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="credit-card" class="icon-sm"></i><span>Student Tuition Payments</span></div>
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
                      <span>• Group: ${p.group_name || 'N/A'}</span>
                      <span class="badge ${badgeClass}">${p.status}</span>
                    </div>
                  </div>
                  <div class="att-controls">
                    ${
                      p.receipt_image
                        ? `<button class="btn btn-ghost" onclick="previewReceipt(${p.id})" title="View Receipt"><i data-lucide="image" class="icon-xs"></i></button>`
                        : ''
                    }
                    <button class="btn btn-success-soft" onclick="updatePaymentStatus(${p.id}, 'approved')" title="Approve"><i data-lucide="check" class="icon-xs"></i></button>
                    <button class="btn btn-danger-soft" onclick="updatePaymentStatus(${p.id}, 'rejected')" title="Reject"><i data-lucide="x" class="icon-xs"></i></button>
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

document.getElementById('close-receipt-modal').addEventListener('click', () => {
  document.getElementById('receipt-modal').classList.remove('open');
});

window.updatePaymentStatus = async (id, status) => {
  try {
    await apiRequest(`/api/payments/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
    triggerHaptic('success');
    showToast(`Payment marked as ${status}`, 'success');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ---------------- TEACHER VIEWS ----------------
function renderTeacherDashboard(container) {
  const myGroups = state.groups.filter((g) => g.teacher_id === state.user.id);
  const groupsToShow = myGroups.length > 0 ? myGroups : state.groups;

  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="book-open" class="icon-sm"></i><span>Assigned Classes</span></div>
      </div>
      <div class="item-list">
        ${groupsToShow
          .map(
            (g) => `
          <div class="list-row">
            <div class="row-main">
              <h4>${g.name}</h4>
              <div class="row-sub">
                <span>Level: ${g.level}</span>
                <span>• Schedule: ${g.schedule}</span>
              </div>
            </div>
            <span class="badge badge-info">${g.student_count || 0} students</span>
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
  const selectedGroupId = groupsList[0]?.id || '';
  const today = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="calendar-check" class="icon-sm"></i><span>Mark Daily Attendance</span></div>
      </div>
      <div class="form-stack">
        <div class="input-group">
          <label>Select Class Group</label>
          <div class="input-field-wrap">
            <i data-lucide="layers" class="input-icon"></i>
            <select id="att-group-select">
              ${groupsList.map((g) => `<option value="${g.id}">${g.name}</option>`).join('')}
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
          <i data-lucide="check-circle-2" class="icon-sm"></i>
          <span>Submit Attendance</span>
        </button>
      </div>
    </div>
  `;

  const groupSelect = document.getElementById('att-group-select');
  const renderSheet = () => {
    const gid = parseInt(groupSelect.value, 10);
    const students = state.users.filter((u) => u.role === 'student' && u.group_id === gid);
    const listEl = document.getElementById('att-student-list');

    if (students.length === 0) {
      listEl.innerHTML = `<p class="row-sub">No students assigned to this group yet.</p>`;
      return;
    }

    state.attendanceDraft = {};
    students.forEach((s) => (state.attendanceDraft[s.id] = 'present'));

    listEl.innerHTML = students
      .map(
        (s) => `
      <div class="list-row" id="att-row-${s.id}">
        <div class="row-main"><h4>${s.full_name}</h4></div>
        <div class="att-controls">
          <button type="button" class="att-pill active-present" onclick="setStudentAtt(${s.id}, 'present')">Present</button>
          <button type="button" class="att-pill" onclick="setStudentAtt(${s.id}, 'late')">Late</button>
          <button type="button" class="att-pill" onclick="setStudentAtt(${s.id}, 'absent')">Absent</button>
        </div>
      </div>
    `
      )
      .join('');
  };

  groupSelect.addEventListener('change', renderSheet);
  if (selectedGroupId) renderSheet();

  document.getElementById('save-att-btn').addEventListener('click', async () => {
    const gid = parseInt(groupSelect.value, 10);
    const dateVal = document.getElementById('att-date-input').value;
    const records = Object.entries(state.attendanceDraft).map(([student_id, status]) => ({
      student_id: parseInt(student_id, 10),
      status
    }));

    try {
      await apiRequest('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({ group_id: gid, date: dateVal, records })
      });
      triggerHaptic('success');
      showToast('Attendance saved!', 'success');
      loadBootstrapData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

window.setStudentAtt = (studentId, status) => {
  triggerHaptic('light');
  state.attendanceDraft[studentId] = status;
  const row = document.getElementById(`att-row-${studentId}`);
  if (!row) return;
  const btns = row.querySelectorAll('.att-pill');
  btns.forEach((b) => {
    b.className = 'att-pill';
    if (b.textContent.toLowerCase() === status) {
      b.classList.add(`active-${status}`);
    }
  });
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
            <input type="text" id="hw-title" placeholder="Unit 5 Reading & Vocabulary Essay" required />
          </div>
        </div>
        <div class="input-group">
          <label>Instructions</label>
          <div class="input-field-wrap">
            <textarea id="hw-desc" placeholder="Complete exercises 1-4 on page 42..."></textarea>
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
              <div class="row-sub">
                <span>Group: ${h.group_name || 'All'}</span>
                <span>• Due: ${h.due_date || 'Next class'}</span>
              </div>
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

  document.getElementById('post-hw-form').addEventListener('submit', async (e) => {
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
    showToast('Assignment deleted', 'info');
    loadBootstrapData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ---------------- STUDENT VIEWS ----------------
function renderStudentDashboard(container) {
  const myAtt = state.attendance.filter((a) => a.student_id === state.user.id);
  const presentCount = myAtt.filter((a) => a.status === 'present' || a.status === 'late').length;
  const attRate = myAtt.length > 0 ? Math.round((presentCount / myAtt.length) * 100) : 100;
  const myGroup = state.groups.find((g) => g.id === state.user.group_id);

  container.innerHTML = `
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
        <div class="section-title"><i data-lucide="calendar-days" class="icon-sm"></i><span>Recent Attendance Log</span></div>
      </div>
      <div class="item-list">
        ${
          myAtt.length === 0
            ? `<p class="row-sub">No attendance records logged yet.</p>`
            : myAtt
                .slice(0, 12)
                .map((a) => {
                  const badge =
                    a.status === 'present' ? 'badge-success' : a.status === 'late' ? 'badge-warning' : 'badge-danger';
                  return `
                <div class="list-row">
                  <div class="row-main">
                    <h4>${new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</h4>
                    <div class="row-sub"><span>${a.group_name || ''}</span></div>
                  </div>
                  <span class="badge ${badge}">${a.status}</span>
                </div>
              `;
                })
                .join('')
        }
      </div>
    </div>
  `;
}

function renderStudentHomework(container) {
  const myHw = state.user.group_id
    ? state.homeworks.filter((h) => h.group_id === state.user.group_id)
    : state.homeworks;

  container.innerHTML = `
    <div class="card-panel fade-in-up">
      <div class="section-header">
        <div class="section-title"><i data-lucide="book-marked" class="icon-sm"></i><span>Course Assignments</span></div>
      </div>
      <div class="item-list">
        ${
          myHw.length === 0
            ? `<p class="row-sub">No homework assignments posted for your group yet.</p>`
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
                <span class="badge badge-info">Active</span>
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
        const maxW = 900;
        const scale = img.width > maxW ? maxW / img.width : 1;
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
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
          <label>Receipt Image Screenshot</label>
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

  document.getElementById('student-pay-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('pay-file');
    const btn = document.getElementById('submit-pay-btn');
    if (!fileInput.files[0]) {
      return showToast('Please attach a receipt screenshot.', 'error');
    }

    try {
      btn.disabled = true;
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
      showToast('Receipt submitted for verification!', 'success');
      loadBootstrapData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

// ==================== INITIALIZATION ====================
document.getElementById('auth-theme-toggle').addEventListener('click', toggleTheme);
document.getElementById('portal-theme-toggle').addEventListener('click', toggleTheme);
document.getElementById('logout-btn').addEventListener('click', logout);

applyTheme(state.theme);
if (state.user) {
  enterPortal();
} else {
  refreshIcons();
}
