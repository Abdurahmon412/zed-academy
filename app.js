const tg = window.Telegram.WebApp;
tg.expand();

let currentUser = null;
let dashboardData = null;
let teacherAttendanceState = {};
let encodedReceiptImage = null;

document.addEventListener('DOMContentLoaded', async () => {
    const tgUser = tg.initDataUnsafe?.user;

    if (tgUser) {
        const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
        document.getElementById('reg-fullname').value = fullName;
        if (tgUser.username) {
            document.getElementById('reg-username').value = tgUser.username;
        }
    }

    await loadPublicGroups();

    const savedUser = localStorage.getItem('zed_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        openMainScreen();
    }
});

tg.BackButton.onClick(() => {
    backToStudentHome();
});

async function loadPublicGroups() {
    try {
        const res = await fetch('/api/public/groups');
        const groups = await res.json();
        const select = document.getElementById('reg-group');
        select.innerHTML = groups.map(g => `<option value="${g.id}">${g.name} (${g.days} | ${g.time})</option>`).join('');
    } catch (e) {
        console.error(e);
    }
}

function switchAuthTab(tab) {
    document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    document.getElementById('tab-login-btn').classList.toggle('active', tab === 'login');
    document.getElementById('tab-reg-btn').classList.toggle('active', tab === 'register');
}

function fillDemo(username, password) {
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = password;
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const telegramId = tg.initDataUnsafe?.user?.id || null;

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, telegramId })
        });
        const data = await res.json();

        if (!data.success) {
            tg.showAlert(data.message || "Xatolik!");
            return;
        }

        currentUser = data.user;
        localStorage.setItem('zed_user', JSON.stringify(currentUser));
        openMainScreen();
    } catch (err) {
        tg.showAlert("Server bilan ulanishda xatolik!");
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const fullName = document.getElementById('reg-fullname').value;
    const phone = document.getElementById('reg-phone').value;
    const groupId = document.getElementById('reg-group').value;
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const telegramId = tg.initDataUnsafe?.user?.id || null;

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName, phone, groupId, username, password, telegramId })
        });
        const data = await res.json();

        if (!data.success) {
            tg.showAlert(data.message || "Xatolik!");
            return;
        }

        currentUser = data.user;
        localStorage.setItem('zed_user', JSON.stringify(currentUser));
        tg.showAlert("🎉 Ro'yxatdan muvaffaqiyatli o'tdingiz!");
        openMainScreen();
    } catch (err) {
        tg.showAlert("Ro'yxatdan o'tishda xatolik!");
    }
}

function logout() {
    localStorage.removeItem('zed_user');
    currentUser = null;
    dashboardData = null;
    tg.BackButton.hide();

    document.getElementById('main-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
}

async function openMainScreen() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');

    document.getElementById('header-name').innerText = currentUser.full_name;
    const initial = currentUser.full_name.charAt(0).toUpperCase();
    document.getElementById('header-avatar').src = `https://ui-avatars.com/api/?name=${initial}&background=EBF5FB&color=2980B9`;

    const roleNames = {
        student: "👨‍🎓 O'quvchi",
        teacher: "👨‍🏫 O'qituvchi",
        admin: "⚙️ Direktor / Admin"
    };
    document.getElementById('header-role-badge').innerText = roleNames[currentUser.role] || currentUser.role;

    document.querySelectorAll('.cabinet').forEach(c => c.classList.add('hidden'));

    if (currentUser.role === 'student') document.getElementById('student-cabinet').classList.remove('hidden');
    if (currentUser.role === 'teacher') document.getElementById('teacher-cabinet').classList.remove('hidden');
    if (currentUser.role === 'admin') document.getElementById('admin-cabinet').classList.remove('hidden');

    await loadDashboardData();
}

async function loadDashboardData() {
    try {
        const res = await fetch(`/api/dashboard/${currentUser.id}`);
        if (!res.ok) {
            logout();
            return;
        }
        dashboardData = await res.json();

        if (currentUser.role === 'student') renderStudentCabinet();
        if (currentUser.role === 'teacher') renderTeacherCabinet();
        if (currentUser.role === 'admin') renderAdminCabinet();
    } catch (e) {
        console.error(e);
    }
}

// ==========================================================
// 1. O'QUVCHI KABINETI VA ONLAYN TO'LOV
// ==========================================================
function renderStudentCabinet() {
    const { group, settings, attendance, attendanceRate, homeworks, payments } = dashboardData;

    // Yuqori dars vaqti banneri
    if (group) {
        document.getElementById('st-banner-group').innerText = `${group.name} (${group.level})`;
        document.getElementById('st-banner-time').innerText = `⏰ ${group.days} | ${group.time}`;
        document.getElementById('st-banner-info').innerText = `👨‍🏫 Ustoz: ${group.teacher_name || '-'} • 🚪 ${group.room}`;
        document.getElementById('st-pay-amount').value = group.price || 450000;
    } else {
        document.getElementById('st-banner-group').innerText = "Guruh biriktirilmagan";
        document.getElementById('st-banner-time').innerText = "⏰ --:--";
        document.getElementById('st-banner-info').innerText = "Ma'muriyatga murojaat qiling";
    }

    document.getElementById('st-level').innerText = group ? group.level : '-';
    document.getElementById('st-rate').innerText = `${attendanceRate}%`;
    document.getElementById('st-hw-count').innerText = `${homeworks.length} ta`;

    // Admin karta ma'lumotlari
    if (settings) {
        document.getElementById('st-card-number').innerText = `${settings.card_number || '8600 0000 0000 0000'} 📋`;
        document.getElementById('st-card-holder').innerText = settings.card_holder || 'ZED ACADEMY';
        document.getElementById('st-card-bank').innerText = settings.card_bank || 'Uzcard / Humo';
    }

    // Davomat
    const statusMap = {
        present: { text: "Keldi", cls: "success" },
        absent: { text: "Kelmadi", cls: "danger" },
        excused: { text: "Sababli", cls: "warning" }
    };

    document.getElementById('st-att-list').innerHTML = attendance.length > 0
        ? attendance.map(a => `
            <div class="list-item">
                <div class="item-main">
                    <h4>${a.date}</h4>
                    <p>${a.topic}</p>
                </div>
                <span class="badge ${statusMap[a.status].cls}">${statusMap[a.status].text}</span>
            </div>
        `).join('')
        : `<div class="panel-card"><p>Hozircha davomat qayd etilmagan.</p></div>`;

    // Guruh tafsiloti
    document.getElementById('st-group-details').innerHTML = group
        ? `
            <div class="panel-card">
                <h3>${group.name}</h3>
                <p style="margin-bottom:8px;">🎓 <b>Daraja:</b> ${group.level}</p>
                <p style="margin-bottom:8px;">👨‍🏫 <b>O'qituvchi:</b> ${group.teacher_name || 'Tayinlanmagan'} (${group.teacher_phone || ''})</p>
                <p style="margin-bottom:8px;">📅 <b>Dars kunlari:</b> ${group.days}</p>
                <p style="margin-bottom:8px;">⏰ <b>Dars boshlanish vaqti:</b> ${group.time}</p>
                <p style="margin-bottom:8px;">🚪 <b>Xona:</b> ${group.room}</p>
                <p>💰 <b>Oylik to'lov:</b> ${Number(group.price || 450000).toLocaleString()} so'm</p>
            </div>
        `
        : `<div class="panel-card"><p>Siz hali guruhga biriktirilmagansiz.</p></div>`;

    // Vazifalar
    document.getElementById('st-hw-list').innerHTML = homeworks.length > 0
        ? homeworks.map(h => `
            <div class="list-item">
                <div class="item-main">
                    <h4>${h.title}</h4>
                    <p>⏳ Muddat: ${h.deadline}</p>
                </div>
                <span class="badge info">Topshiriq</span>
            </div>
        `).join('')
        : `<div class="panel-card"><p>Hozircha uyga vazifalar yo'q.</p></div>`;

    // To'lovlar tarixi
    const payStatusMap = {
        approved: { text: "Tasdiqlangan ✅", cls: "success" },
        pending: { text: "Kutilmoqda ⏳", cls: "warning" },
        rejected: { text: "Rad etilgan ❌", cls: "danger" }
    };

    document.getElementById('st-pay-list').innerHTML = payments.length > 0
        ? payments.map(p => {
            const st = payStatusMap[p.status] || payStatusMap.approved;
            return `
                <div class="list-item">
                    <div class="item-main">
                        <h4>${p.month}</h4>
                        <p>${Number(p.amount).toLocaleString()} so'm • ${p.date}</p>
                    </div>
                    <div class="item-actions">
                        ${p.receipt_image ? `<button class="icon-btn" onclick="viewReceipt('${p.receipt_image}')">🧾 Chek</button>` : ''}
                        <span class="badge ${st.cls}">${st.text}</span>
                    </div>
                </div>
            `;
        }).join('')
        : `<p style="font-size:12.5px; color:#64748B;">Hozircha to'lovlar yo'q.</p>`;
}

function copyCardNumber() {
    const raw = (dashboardData?.settings?.card_number || '').replace(/\s+/g, '');
    if (navigator.clipboard && raw) {
        navigator.clipboard.writeText(raw);
        tg.showAlert("📋 Karta raqami nusxalandi!");
    }
}

// Chek rasmini siqib Base64 ga o'girish (tez yuklanishi uchun)
function previewReceipt(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const maxDim = 900;
            let w = img.width;
            let h = img.height;

            if (w > h && w > maxDim) {
                h *= maxDim / w;
                w = maxDim;
            } else if (h > maxDim) {
                w *= maxDim / h;
                h = maxDim;
            }

            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            encodedReceiptImage = canvas.toDataURL('image/jpeg', 0.75);
            document.getElementById('st-receipt-img').src = encodedReceiptImage;
            document.getElementById('st-receipt-preview-box').classList.remove('hidden');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function submitStudentPayment() {
    const month = document.getElementById('st-pay-month').value;
    const amount = document.getElementById('st-pay-amount').value;

    if (!amount || !encodedReceiptImage) {
        tg.showAlert("Iltimos, to'lov cheki rasmini (skrinshot) yuklang!");
        return;
    }

    const res = await fetch('/api/student/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            studentId: currentUser.id,
            month,
            amount,
            receiptImage: encodedReceiptImage
        })
    });

    if ((await res.json()).success) {
        encodedReceiptImage = null;
        document.getElementById('st-pay-file').value = '';
        document.getElementById('st-receipt-preview-box').classList.add('hidden');
        tg.showAlert("✅ To'lov chekingiz Adminga yuborildi! Admin tekshirib tasdiqlagach, sizga xabar keladi.");
        loadDashboardData();
    }
}

function openStudentSubView(viewId) {
    document.querySelectorAll('#student-cabinet .sub-view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    tg.BackButton.show();
}

function backToStudentHome() {
    document.querySelectorAll('#student-cabinet .sub-view').forEach(v => v.classList.remove('active'));
    document.getElementById('student-home').classList.add('active');
    tg.BackButton.hide();
}

// ==========================================================
// 2. O'QITUVCHI KABINETI (DARS VAQTLARI VA YO'QLAMA)
// ==========================================================
function renderTeacherCabinet() {
    const { groups, homeworks } = dashboardData;

    // 1. Dars boshlanish vaqti va guruhlar jadvali
    const scheduleContainer = document.getElementById('teacher-schedule-cards');
    if (groups.length === 0) {
        scheduleContainer.innerHTML = `<p style="font-size:13px; color:#64748B;">Sizga hali guruh biriktirilmagan.</p>`;
    } else {
        scheduleContainer.innerHTML = groups.map(g => `
            <div class="schedule-item">
                <div>
                    <h4>${g.name} (${g.level})</h4>
                    <p>📅 ${g.days} • 🚪 ${g.room}</p>
                </div>
                <div class="time-badge">
                    ⏰ ${g.time}
                </div>
            </div>
        `).join('');
    }

    const groupOptions = groups.map(g => `<option value="${g.id}">${g.name} (${g.time})</option>`).join('');
    document.getElementById('teacher-group-select').innerHTML = groupOptions;
    document.getElementById('hw-group-select').innerHTML = groupOptions;

    renderTeacherStudents();

    document.getElementById('teacher-hw-list').innerHTML = homeworks.length > 0
        ? homeworks.map(h => `
            <div class="list-item">
                <div class="item-main">
                    <h4>${h.title}</h4>
                    <p>${h.group_name} • Muddat: ${h.deadline}</p>
                </div>
            </div>
        `).join('')
        : `<p style="font-size:12.5px; color:#64748B;">Hozircha vazifa berilmagan.</p>`;
}

function renderTeacherStudents() {
    const groupId = Number(document.getElementById('teacher-group-select').value);
    const group = dashboardData.groups.find(g => g.id === groupId);

    if (group) {
        document.getElementById('teacher-selected-time').innerText = `⏰ Dars boshlanish vaqti: ${group.time} (${group.days} | ${group.room})`;
    }

    const students = dashboardData.students.filter(s => s.group_id === groupId);
    teacherAttendanceState = {};
    students.forEach(s => { teacherAttendanceState[s.id] = 'present'; });

    drawTeacherStudentList(students);
}

function drawTeacherStudentList(students) {
    const container = document.getElementById('teacher-student-list');
    if (students.length === 0) {
        container.innerHTML = `<p style="font-size:13px; color:#64748B;">Bu guruhda o'quvchilar yo'q.</p>`;
        return;
    }

    container.innerHTML = students.map(s => {
        const st = teacherAttendanceState[s.id] || 'present';
        return `
            <div class="list-item">
                <div class="item-main">
                    <h4>${s.full_name}</h4>
                    <p>${s.phone}</p>
                </div>
                <div class="att-controls">
                    <button class="att-btn ${st === 'present' ? 'present' : ''}" onclick="setAtt(${s.id}, 'present')">✓</button>
                    <button class="att-btn ${st === 'absent' ? 'absent' : ''}" onclick="setAtt(${s.id}, 'absent')">✕</button>
                    <button class="att-btn ${st === 'excused' ? 'excused' : ''}" onclick="setAtt(${s.id}, 'excused')">?</button>
                </div>
            </div>
        `;
    }).join('');
}

function setAtt(studentId, status) {
    teacherAttendanceState[studentId] = status;
    const groupId = Number(document.getElementById('teacher-group-select').value);
    const students = dashboardData.students.filter(s => s.group_id === groupId);
    drawTeacherStudentList(students);
}

async function submitAttendance() {
    const groupId = Number(document.getElementById('teacher-group-select').value);
    const topic = document.getElementById('teacher-topic').value.trim() || "Amaliy dars";
    const today = new Date().toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' });

    const records = Object.keys(teacherAttendanceState).map(id => ({
        studentId: Number(id),
        status: teacherAttendanceState[id]
    }));

    if (records.length === 0) {
        tg.showAlert("Guruhda o'quvchilar yo'q!");
        return;
    }

    const res = await fetch('/api/teacher/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, date: today, topic, records })
    });

    if ((await res.json()).success) {
        document.getElementById('teacher-topic').value = '';
        tg.showAlert("✅ Davomat saqlandi!");
        loadDashboardData();
    }
}

async function submitHomework() {
    const groupId = Number(document.getElementById('hw-group-select').value);
    const title = document.getElementById('hw-title-input').value.trim();
    const deadline = document.getElementById('hw-deadline-input').value.trim();

    if (!title || !deadline) {
        tg.showAlert("Vazifa nomi va muddatini kiriting!");
        return;
    }

    const res = await fetch('/api/teacher/homework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, title, deadline })
    });

    if ((await res.json()).success) {
        document.getElementById('hw-title-input').value = '';
        document.getElementById('hw-deadline-input').value = '';
        tg.showAlert("📚 Uyga vazifa yuborildi!");
        loadDashboardData();
    }
}

function switchTeacherTab(tabId, btn) {
    document.querySelectorAll('#teacher-cabinet .sec-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('#teacher-cabinet .tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
}

// ==========================================================
// 3. ADMIN KABINETI (TO'LIQ CRUD, CHEK TASDIQLASH VA HISOBOT)
// ==========================================================
function renderAdminCabinet() {
    const { stats, settings, students, teachers, groups, payments, groupReports } = dashboardData;

    document.getElementById('adm-st-count').innerText = stats.totalStudents;
    document.getElementById('adm-tc-count').innerText = stats.totalTeachers;
    document.getElementById('adm-gr-count').innerText = stats.totalGroups;
    document.getElementById('adm-rev').innerText = `${stats.totalCollected.toLocaleString()} so'm`;

    // Pending badge
    const pendingBadge = document.getElementById('pending-badge');
    if (stats.pendingCount > 0) {
        pendingBadge.innerText = stats.pendingCount;
        pendingBadge.classList.remove('hidden');
    } else {
        pendingBadge.classList.add('hidden');
    }

    // Karta sozlamalari
    if (settings) {
        document.getElementById('adm-card-number').value = settings.card_number || '';
        document.getElementById('adm-card-holder').value = settings.card_holder || '';
        document.getElementById('adm-card-bank').value = settings.card_bank || '';
    }

    // Select'lar
    document.getElementById('adm-u-group').innerHTML = groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    document.getElementById('adm-g-teacher').innerHTML = teachers.map(t => `<option value="${t.id}">${t.full_name} (${t.username})</option>`).join('');
    document.getElementById('adm-p-student').innerHTML = students.map(s => `<option value="${s.id}">${s.full_name} (${s.phone})</option>`).join('');

    // O'qituvchilar ro'yxati (Tahrirlash va O'chirish bilan)
    document.getElementById('adm-teachers-list').innerHTML = teachers.map(t => `
        <div class="list-item">
            <div class="item-main">
                <h4>${t.full_name}</h4>
                <p>🔑 Login: <b>${t.username}</b> | Parol: <b>${t.password}</b></p>
                <p>📞 ${t.phone}</p>
            </div>
            <div class="item-actions">
                <button class="icon-btn" onclick="startEditUser(${t.id})">✏️</button>
                <button class="icon-btn danger" onclick="deleteUser(${t.id})">🗑️</button>
            </div>
        </div>
    `).join('');

    // O'quvchilar ro'yxati (Tahrirlash va O'chirish bilan)
    document.getElementById('adm-students-list').innerHTML = students.map(s => {
        const gr = groups.find(g => g.id === s.group_id);
        return `
            <div class="list-item">
                <div class="item-main">
                    <h4>${s.full_name}</h4>
                    <p>👥 Guruh: <b>${gr ? gr.name : 'Biriktirilmagan'}</b></p>
                    <p>🔑 Login: <b>${s.username}</b> | Parol: <b>${s.password}</b> • ${s.phone}</p>
                </div>
                <div class="item-actions">
                    <button class="icon-btn" onclick="startEditUser(${s.id})">✏️</button>
                    <button class="icon-btn danger" onclick="deleteUser(${s.id})">🗑️</button>
                </div>
            </div>
        `;
    }).join('');

    // Guruhlar ro'yxati (Tahrirlash va O'chirish bilan)
    document.getElementById('adm-groups-list').innerHTML = groups.map(g => `
        <div class="list-item">
            <div class="item-main">
                <h4>${g.name} (${g.level})</h4>
                <p>👨‍🏫 ${g.teacher_name || 'Tayinlanmagan'} • 🚪 ${g.room}</p>
                <p>📅 ${g.days} | ⏰ ${g.time} • 💰 ${Number(g.price || 450000).toLocaleString()} so'm</p>
            </div>
            <div class="item-actions">
                <button class="icon-btn" onclick="startEditGroup(${g.id})">✏️</button>
                <button class="icon-btn danger" onclick="deleteGroup(${g.id})">🗑️</button>
            </div>
        </div>
    `).join('');

    // Kutilayotgan cheklar
    const pendingPayments = payments.filter(p => p.status === 'pending');
    document.getElementById('adm-pending-payments').innerHTML = pendingPayments.length > 0
        ? pendingPayments.map(p => `
            <div class="list-item">
                <div class="item-main">
                    <h4>${p.student_name}</h4>
                    <p>${p.month} • <b>${Number(p.amount).toLocaleString()} so'm</b> (${p.date})</p>
                </div>
                <div class="item-actions">
                    ${p.receipt_image ? `<button class="icon-btn" onclick="viewReceipt('${p.receipt_image}')">🧾 Chek</button>` : ''}
                    <button class="icon-btn success" onclick="handlePaymentDecision(${p.id}, 'approved')">✅</button>
                    <button class="icon-btn danger" onclick="handlePaymentDecision(${p.id}, 'rejected')">❌</button>
                </div>
            </div>
        `).join('')
        : `<p style="font-size:12.5px; color:#64748B;">Hozircha tasdiqlanmagan cheklar yo'q.</p>`;

    // Barcha to'lovlar
    const payStatusMap = {
        approved: { text: "Tasdiqlandi", cls: "success" },
        pending: { text: "Kutilmoqda", cls: "warning" },
        rejected: { text: "Rad etildi", cls: "danger" }
    };
    document.getElementById('adm-pay-list').innerHTML = payments.map(p => {
        const st = payStatusMap[p.status] || payStatusMap.approved;
        return `
            <div class="list-item">
                <div class="item-main">
                    <h4>${p.student_name}</h4>
                    <p>${p.month} • ${Number(p.amount).toLocaleString()} so'm (${p.date})</p>
                </div>
                <div class="item-actions">
                    ${p.receipt_image ? `<button class="icon-btn" onclick="viewReceipt('${p.receipt_image}')">🧾</button>` : ''}
                    <span class="badge ${st.cls}">${st.text}</span>
                </div>
            </div>
        `;
    }).join('');

    // 4. Statistik Hisobotlar
    document.getElementById('adm-report-summary').innerHTML = `
        <div class="summary-row"><span>👨‍🎓 Jami faol o'quvchilar:</span><b>${stats.totalStudents} nafar</b></div>
        <div class="summary-row"><span>👨‍🏫 Jami o'qituvchilar:</span><b>${stats.totalTeachers} nafar</b></div>
        <div class="summary-row"><span>📈 Markaz o'rtacha davomati:</span><b>${stats.overallAttRate}%</b></div>
        <div class="summary-row"><span>✅ Tasdiqlangan tushum:</span><b style="color:#16A34A;">${stats.totalCollected.toLocaleString()} so'm</b></div>
        <div class="summary-row"><span>⏳ Kutilayotgan to'lovlar (${stats.pendingCount} ta):</span><b style="color:#D97706;">${stats.totalPending.toLocaleString()} so'm</b></div>
    `;

    document.getElementById('adm-report-table-body').innerHTML = groupReports.map(r => `
        <tr>
            <td><b>${r.name}</b><br><small>${r.days} (${r.time})</small></td>
            <td>${r.teacher}</td>
            <td>${r.studentCount} ta</td>
            <td>${r.attendanceRate}%</td>
            <td><b>${r.collectedAmount.toLocaleString()}</b> / <small>${r.expectedAmount.toLocaleString()}</small></td>
        </tr>
    `).join('');
}

function toggleAdminGroupSelect() {
    const role = document.getElementById('adm-u-role').value;
    document.getElementById('adm-u-group-wrap').style.display = role === 'student' ? 'block' : 'none';
}

// FOYDALANUVCHI QO'SHISH VA TAHRIRLASH
async function adminSaveUser() {
    const editId = document.getElementById('adm-u-edit-id').value;
    const role = document.getElementById('adm-u-role').value;
    const fullName = document.getElementById('adm-u-name').value;
    const phone = document.getElementById('adm-u-phone').value;
    const groupId = document.getElementById('adm-u-group').value;
    const username = document.getElementById('adm-u-login').value;
    const password = document.getElementById('adm-u-pass').value;

    if (!fullName || !phone || !username || !password) {
        tg.showAlert("Barcha maydonlarni to'ldiring!");
        return;
    }

    const url = editId ? `/api/admin/users/${editId}` : '/api/admin/users';
    const method = editId ? 'PUT' : 'POST';

    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, phone, role, groupId, username, password })
    });
    const data = await res.json();

    if (!data.success) {
        tg.showAlert(data.message || "Xatolik!");
        return;
    }

    resetUserForm();
    tg.showAlert(editId ? "✅ Ma'lumotlar yangilandi!" : "✅ Yangi akkaunt ochildi!");
    loadDashboardData();
}

function startEditUser(userId) {
    const u = dashboardData.users.find(x => x.id === userId);
    if (!u) return;

    document.getElementById('user-form-title').innerText = `✏️ Tahrirlash: ${u.full_name}`;
    document.getElementById('adm-u-edit-id').value = u.id;
    document.getElementById('adm-u-role').value = u.role;
    document.getElementById('adm-u-name').value = u.full_name;
    document.getElementById('adm-u-phone').value = u.phone;
    document.getElementById('adm-u-login').value = u.username;
    document.getElementById('adm-u-pass').value = u.password || '';
    if (u.group_id) document.getElementById('adm-u-group').value = u.group_id;

    toggleAdminGroupSelect();
    document.getElementById('adm-u-submit-btn').innerText = "💾 O'zgarishni saqlash";
    document.getElementById('adm-u-cancel-btn').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetUserForm() {
    document.getElementById('user-form-title').innerText = "➕ Yangi O'quvchi / O'qituvchi ochish";
    document.getElementById('adm-u-edit-id').value = '';
    document.getElementById('adm-u-name').value = '';
    document.getElementById('adm-u-phone').value = '';
    document.getElementById('adm-u-login').value = '';
    document.getElementById('adm-u-pass').value = '';
    document.getElementById('adm-u-submit-btn').innerText = "➕ Saqlash";
    document.getElementById('adm-u-cancel-btn').classList.add('hidden');
}

async function deleteUser(userId) {
    if (!confirm("Haqiqatan ham bu foydalanuvchini o'chirmoqchimisiz?")) return;
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if ((await res.json()).success) {
        tg.showAlert("🗑️ O'chirildi!");
        loadDashboardData();
    }
}

// GURUH QO'SHISH, TAHRIRLASH VA O'CHIRISH
async function adminSaveGroup() {
    const editId = document.getElementById('adm-g-edit-id').value;
    const name = document.getElementById('adm-g-name').value;
    const level = document.getElementById('adm-g-level').value;
    const teacherId = document.getElementById('adm-g-teacher').value;
    const days = document.getElementById('adm-g-days').value;
    const time = document.getElementById('adm-g-time').value;
    const room = document.getElementById('adm-g-room').value;
    const price = document.getElementById('adm-g-price').value;

    if (!name || !level || !days || !time) {
        tg.showAlert("Guruh ma'lumotlarini to'liq kiriting!");
        return;
    }

    const url = editId ? `/api/admin/groups/${editId}` : '/api/admin/groups';
    const method = editId ? 'PUT' : 'POST';

    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, level, teacherId, days, time, room, price })
    });

    if ((await res.json()).success) {
        resetGroupForm();
        tg.showAlert(editId ? "✅ Guruh yangilandi!" : "✅ Yangi guruh ochildi!");
        loadDashboardData();
        loadPublicGroups();
    }
}

function startEditGroup(groupId) {
    const g = dashboardData.groups.find(x => x.id === groupId);
    if (!g) return;

    document.getElementById('group-form-title').innerText = `✏️ Guruhni tahrirlash: ${g.name}`;
    document.getElementById('adm-g-edit-id').value = g.id;
    document.getElementById('adm-g-name').value = g.name;
    document.getElementById('adm-g-level').value = g.level;
    if (g.teacher_id) document.getElementById('adm-g-teacher').value = g.teacher_id;
    document.getElementById('adm-g-days').value = g.days;
    document.getElementById('adm-g-time').value = g.time;
    document.getElementById('adm-g-room').value = g.room;
    document.getElementById('adm-g-price').value = g.price || 450000;

    document.getElementById('adm-g-submit-btn').innerText = "💾 O'zgarishni saqlash";
    document.getElementById('adm-g-cancel-btn').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetGroupForm() {
    document.getElementById('group-form-title').innerText = "➕ Yangi guruh ochish";
    document.getElementById('adm-g-edit-id').value = '';
    document.getElementById('adm-g-name').value = '';
    document.getElementById('adm-g-level').value = '';
    document.getElementById('adm-g-days').value = '';
    document.getElementById('adm-g-time').value = '';
    document.getElementById('adm-g-room').value = '';
    document.getElementById('adm-g-submit-btn').innerText = "➕ Guruhni saqlash";
    document.getElementById('adm-g-cancel-btn').classList.add('hidden');
}

async function deleteGroup(groupId) {
    if (!confirm("Haqiqatan ham bu guruhni o'chirmoqchimisiz?")) return;
    const res = await fetch(`/api/admin/groups/${groupId}`, { method: 'DELETE' });
    if ((await res.json()).success) {
        tg.showAlert("🗑️ Guruh o'chirildi!");
        loadDashboardData();
    }
}

// KARTA VA TO'LOVLARNI BOSHQARISH
async function adminSaveCard() {
    const cardNumber = document.getElementById('adm-card-number').value;
    const cardHolder = document.getElementById('adm-card-holder').value;
    const cardBank = document.getElementById('adm-card-bank').value;

    const res = await fetch('/api/admin/settings/card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardNumber, cardHolder, cardBank })
    });

    if ((await res.json()).success) {
        tg.showAlert("💳 Karta ma'lumotlari saqlandi!");
        loadDashboardData();
    }
}

async function handlePaymentDecision(paymentId, status) {
    const res = await fetch(`/api/admin/payments/${paymentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    });

    if ((await res.json()).success) {
        tg.showAlert(status === 'approved' ? "✅ To'lov tasdiqlandi!" : "❌ To'lov rad etildi!");
        loadDashboardData();
    }
}

async function adminCreatePayment() {
    const studentId = document.getElementById('adm-p-student').value;
    const month = document.getElementById('adm-p-month').value;
    const amount = document.getElementById('adm-p-amount').value;

    const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, month, amount })
    });

    if ((await res.json()).success) {
        tg.showAlert("✅ To'lov kiritildi!");
        loadDashboardData();
    }
}

// CHEK RASMINI MODALDA KO'RISH
function viewReceipt(imgData) {
    document.getElementById('modal-receipt-img').src = imgData;
    document.getElementById('receipt-modal').classList.remove('hidden');
}

function closeReceiptModal() {
    document.getElementById('receipt-modal').classList.add('hidden');
}

// HISOBOTNI EXCEL (CSV) SHAKLIDA YUKLAB OLISH
function exportReportsCSV() {
    if (!dashboardData || !dashboardData.groupReports) return;

    let csv = "Guruh,Daraja,O'qituvchi,Kunlar,Vaqt,O'quvchilar soni,Davomat (%),Tushum (so'm),Kutilgan (so'm)\n";
    dashboardData.groupReports.forEach(r => {
        csv += `"${r.name}","${r.level}","${r.teacher}","${r.days}","${r.time}",${r.studentCount},${r.attendanceRate}%,${r.collectedAmount},${r.expectedAmount}\n`;
    });

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ZED_Academy_Hisobot_${new Date().toLocaleDateString('ru-RU')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function switchAdminTab(tabId, btn) {
    document.querySelectorAll('#admin-cabinet .sec-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('#admin-cabinet .tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
}