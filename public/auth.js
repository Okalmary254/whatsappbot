const form = document.getElementById('authForm');
const isSignup = window.location.pathname.replace(/\/+$/, '') === '/signup';
const title = document.getElementById('authTitle');
const subtitle = document.getElementById('authSubtitle');
const submit = document.getElementById('submitButton');
const errorBox = document.getElementById('formError');
const password = document.getElementById('password');
const switchLine = document.getElementById('authSwitch');

title.textContent = isSignup ? 'Create your account' : 'Sign in to Whatsy';
subtitle.textContent = isSignup ? 'Create a private workspace for your WhatsApp assistant.' : 'Manage your own WhatsApp assistant and session.';
submit.textContent = isSignup ? 'Create account' : 'Sign in';
password.autocomplete = isSignup ? 'new-password' : 'current-password';
switchLine.innerHTML = isSignup ? 'Already registered? <a href="/login">Sign in</a>' : 'New to Whatsy? <a href="/signup">Create an account</a>';

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  submit.disabled = true;
  submit.textContent = isSignup ? 'Creating account…' : 'Signing in…';
  try {
    const response = await fetch(isSignup ? '/api/tenant/signup' : '/api/tenant/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: document.getElementById('email').value.trim(), password: password.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    window.location.assign('/portal');
  } catch (error) {
    errorBox.textContent = error.message || 'Could not connect to Whatsy.';
  } finally {
    submit.disabled = false;
    submit.textContent = isSignup ? 'Create account' : 'Sign in';
  }
});
