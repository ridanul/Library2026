  Auth.redirectIfLoggedIn();

  // Department / session choices shared by the register form (mirrors Backend/app/schemas.py).
  const REG_DEPARTMENTS = ['CSE', 'EEE', 'CE', 'ME', 'BBA', 'Economics', 'English', 'Law', 'Arts & Humanities', 'Pharmacy'];
  const REG_SESSIONS = ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26'];

  document.getElementById('regDepartment').innerHTML =
    '<option value="" disabled selected>Select department</option>' +
    REG_DEPARTMENTS.map((d) => `<option value="${d}">${d}</option>`).join('');
  document.getElementById('sessionList').innerHTML =
    REG_SESSIONS.map((s) => `<option value="${s}"></option>`).join('');

  // Teachers don't provide a student ID; students must enter exactly 12 digits.
  const studentIdInput = document.getElementById('regStudentId');
  function syncStudentField() {
    const isStudent = document.getElementById('regRoleType').value === 'student';
    document.getElementById('studentIdWrap').classList.toggle('hidden', !isStudent);
    studentIdInput.required = isStudent;
    if (!isStudent) studentIdInput.value = '';
  }
  studentIdInput.addEventListener('input', () => {
    // keep only digits, capped at 12 — no hyphens, spaces or letters
    studentIdInput.value = studentIdInput.value.replace(/\D/g, '').slice(0, 12);
  });

  // Teachers have no academic session — hide the Session field for them.
  const sessionInput = document.getElementById('regSession');
  function syncSessionField() {
    const isStudent = document.getElementById('regRoleType').value === 'student';
    document.getElementById('regSessionWrap').classList.toggle('hidden', !isStudent);
    sessionInput.required = isStudent;
    if (!isStudent) sessionInput.value = '';
  }

  document.getElementById('regRoleType').addEventListener('change', () => {
    syncStudentField();
    syncSessionField();
  });
  syncStudentField();
  syncSessionField();

  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const registerErrorEl = document.getElementById('registerError');
  const registerNoticeEl = document.getElementById('registerNotice');
  const signupVerificationSection = document.getElementById('signupVerificationSection');
  const registerSubmitBtn = document.getElementById('registerSubmitBtn');

  const loginErrorEl = document.getElementById('loginError');
  const loginVerificationSection = document.getElementById('loginVerificationSection');
  const loginVerificationNotice = document.getElementById('loginVerificationNotice');
  const loginVerifyError = document.getElementById('loginVerifyError');

  let signupEmail = '';
  let signupPassword = '';
  let loginVerificationEmail = '';
  let existingUnverified = false; // true while resuming verification for an old account

  function activateTab(which) {
    const isLogin = which === 'login';
    loginForm.classList.toggle('hidden', !isLogin);
    registerForm.classList.toggle('hidden', isLogin);
    tabLogin.classList.toggle('bg-white', isLogin);
    tabLogin.classList.toggle('text-ink', isLogin);
    tabLogin.classList.toggle('shadow-sm', isLogin);
    tabLogin.classList.toggle('text-charcoal/50', !isLogin);
    tabRegister.classList.toggle('bg-white', !isLogin);
    tabRegister.classList.toggle('text-ink', !isLogin);
    tabRegister.classList.toggle('shadow-sm', !isLogin);
    tabRegister.classList.toggle('text-charcoal/50', isLogin);
  }

  function hideEl(el) { el.classList.add('hidden'); }
  function showEl(el) { el.classList.remove('hidden'); }

  // Password policy (mirrors Auth.passwordProblem / Backend schemas).
  // Returns '' when valid, otherwise a human-friendly message.
  function validatePasswordStrength(pw) {
    return Auth.passwordProblem(pw);
  }

  function showLoginVerification(email, message) {
    loginVerificationEmail = email;
    loginVerificationNotice.textContent = message || 'Your email is not verified. Enter the OTP sent to your email.';
    showEl(loginVerificationSection);
    hideEl(loginVerifyError);
    document.getElementById('loginVerifyCode').value = '';
    document.getElementById('loginVerifyCode').focus();
  }

  tabLogin.addEventListener('click', () => activateTab('login'));
  tabRegister.addEventListener('click', () => activateTab('register'));
  activateTab('login');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideEl(loginErrorEl);
    hideEl(loginVerifyError);
    try {
      const { token, user } = await Api.login({
        email: document.getElementById('loginEmail').value.trim(),
        password: document.getElementById('loginPassword').value,
      });
      Auth.setSession(token, user);
      window.location.href = 'dashboard.html';
    } catch (err) {
      const isUnverified = err.status === 403 && /not verified/i.test(err.message || '');
      if (isUnverified) {
        showLoginVerification(document.getElementById('loginEmail').value.trim(), err.message);
        return;
      }
      loginErrorEl.textContent = err.message || 'Could not sign in.';
      showEl(loginErrorEl);
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideEl(registerErrorEl);
    hideEl(registerNoticeEl);
    hideEl(signupVerificationSection);

    try {
      signupEmail = document.getElementById('regEmail').value.trim();
      signupPassword = document.getElementById('regPassword').value;

      const pwProblem = validatePasswordStrength(signupPassword);
      if (pwProblem) {
        registerErrorEl.textContent = pwProblem;
        showEl(registerErrorEl);
        document.getElementById('regPassword').focus();
        return;
      }

      const roleType = document.getElementById('regRoleType').value; // "student" | "teacher"
      const studentId = roleType === 'student' ? studentIdInput.value.replace(/\D/g, '') : '';
      if (roleType === 'student' && studentId.length !== 12) {
        registerErrorEl.textContent = 'Student ID must be exactly 12 digits (no hyphens or spaces).';
        showEl(registerErrorEl);
        document.getElementById('regStudentId').focus();
        return;
      }

      const resp = await Api.register({
        name: document.getElementById('regName').value.trim(),
        email: signupEmail,
        password: signupPassword,
        role: roleType,
        department: document.getElementById('regDepartment').value,
        session: document.getElementById('regSession').value.trim(),
        student_id: studentId,
      });

      if (resp && resp.accountExistsUnverified === true) {
        // This email belongs to an account that was never verified —
        // resume its OTP flow instead of creating a duplicate account.
        existingUnverified = true;
        registerSubmitBtn.classList.add('hidden');
        showEl(signupVerificationSection);
        registerNoticeEl.textContent = 'You already have an account with this email but it is not verified yet. A fresh OTP has been sent — enter it below to continue.';
        showEl(registerNoticeEl);
        document.getElementById('signupVerifyCode').value = '';
        hideEl(document.getElementById('signupVerifyError'));
        document.getElementById('signupVerifyCode').focus();
        return;
      }

      if (resp && (resp.pendingVerification === true || !resp.token)) {
        existingUnverified = false;
        registerSubmitBtn.classList.add('hidden');
        showEl(signupVerificationSection);
        registerNoticeEl.textContent = 'An OTP has been sent to your email. Enter it below to complete verification.';
        showEl(registerNoticeEl);
        document.getElementById('signupVerifyCode').value = '';
        hideEl(document.getElementById('signupVerifyError'));
        document.getElementById('signupVerifyCode').focus();
        return;
      }

      if (resp && resp.token && resp.user) {
        Auth.setSession(resp.token, resp.user);
        window.location.href = 'dashboard.html';
        return;
      }

      registerNoticeEl.textContent = 'Registration received. Please check your email for an OTP.';
      showEl(registerNoticeEl);
    } catch (err) {
      registerErrorEl.textContent = err.message || 'Could not create account.';
      showEl(registerErrorEl);
    }
  });

  document.getElementById('signupVerifyBtn').addEventListener('click', async () => {
    const code = document.getElementById('signupVerifyCode').value.trim();
    const verifyErrorEl = document.getElementById('signupVerifyError');
    if (!code) {
      verifyErrorEl.textContent = 'Please enter the OTP.';
      showEl(verifyErrorEl);
      return;
    }
    try {
      const verifyResp = await Api.verifyEmail({ email: signupEmail, code });
      if (existingUnverified) {
        // Verified the pre-existing account; never auto-login here because the
        // password typed into the register form may not match that account.
        existingUnverified = false;
        registerNoticeEl.textContent = '✅ Email verified. Please sign in with your existing password.';
        showEl(registerNoticeEl);
        hideEl(signupVerificationSection);
        registerSubmitBtn.classList.remove('hidden');
        document.getElementById('regPassword').value = '';
        document.getElementById('loginEmail').value = signupEmail;
        document.getElementById('loginPassword').focus();
        activateTab('login');
        return;
      }
      if (verifyResp.pendingApproval) {
        registerNoticeEl.textContent = '✅ Email verified. An admin must approve your account before you can sign in.';
        showEl(registerNoticeEl);
        hideEl(signupVerificationSection);
        registerSubmitBtn.classList.remove('hidden');
        registerForm.reset();
        document.getElementById('regRole').value = 'student';
        document.getElementById('regRoleType').value = 'student';
        syncStudentField();
        syncSessionField();
        document.getElementById('loginEmail').value = signupEmail;
        activateTab('login');
        return;
      }
      const { token, user } = await Api.login({ email: signupEmail, password: signupPassword });
      Auth.setSession(token, user);
      window.location.href = 'dashboard.html';
    } catch (err) {
      verifyErrorEl.textContent = err.message || 'Verification failed.';
      showEl(verifyErrorEl);
    }
  });

  document.getElementById('signupResendBtn').addEventListener('click', async () => {
    const verifyErrorEl = document.getElementById('signupVerifyError');
    hideEl(verifyErrorEl);
    try {
      await Api.resendVerification({ email: signupEmail });
      registerNoticeEl.textContent = 'A new OTP has been sent to your email.';
      showEl(registerNoticeEl);
    } catch (err) {
      verifyErrorEl.textContent = err.message || 'Could not resend OTP.';
      showEl(verifyErrorEl);
    }
  });

  document.getElementById('loginVerifyBtn').addEventListener('click', async () => {
    const code = document.getElementById('loginVerifyCode').value.trim();
    hideEl(loginVerifyError);
    if (!code) {
      loginVerifyError.textContent = 'Please enter the OTP.';
      showEl(loginVerifyError);
      return;
    }
    try {
      const verifyResp = await Api.verifyEmail({ email: loginVerificationEmail, code });
      if (verifyResp.pendingApproval) {
        loginVerifyError.textContent = 'Email verified. Your account still needs admin approval before login.';
        showEl(loginVerifyError);
        return;
      }
      const { token, user } = await Api.login({
        email: loginVerificationEmail,
        password: document.getElementById('loginPassword').value,
      });
      Auth.setSession(token, user);
      window.location.href = 'dashboard.html';
    } catch (err) {
      loginVerifyError.textContent = err.message || 'Verification failed.';
      showEl(loginVerifyError);
    }
  });

  document.getElementById('loginResendBtn').addEventListener('click', async () => {
    hideEl(loginVerifyError);
    try {
      await Api.resendVerification({ email: loginVerificationEmail || document.getElementById('loginEmail').value.trim() });
      loginVerificationNotice.textContent = 'A new OTP has been sent. Enter it below.';
    } catch (err) {
      loginVerifyError.textContent = err.message || 'Could not resend OTP.';
      showEl(loginVerifyError);
    }
  });