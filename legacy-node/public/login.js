const tabs = document.querySelectorAll(".tab");
const forms = document.querySelectorAll("[data-form]");
tabs.forEach(tab => tab.addEventListener("click", () => {
  tabs.forEach(item => { item.classList.toggle("active", item === tab); item.setAttribute("aria-selected", String(item === tab)); });
  forms.forEach(form => form.classList.toggle("hidden", form.dataset.form !== tab.dataset.tab));
}));

async function submitAuth(form, endpoint) {
  const status = form.querySelector(".form-status");
  const button = form.querySelector("button[type=submit]");
  status.textContent = ""; button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    await FormSpace.api(endpoint, { method: "POST", body: JSON.stringify(values) });
    status.className = "form-status success"; status.textContent = "Готово. Открываем кабинет…";
    const session = await FormSpace.loadSession();
    location.href = session?.role === "admin" ? "/admin" : "/cabinet";
  } catch (error) {
    status.className = "form-status"; status.textContent = error.message;
  } finally { button.disabled = false; }
}

document.getElementById("login-form").addEventListener("submit", e => { e.preventDefault(); submitAuth(e.currentTarget, "/api/login"); });
document.getElementById("register-form").addEventListener("submit", e => { e.preventDefault(); submitAuth(e.currentTarget, "/api/register"); });

FormSpace.loadSession().then(user => {
  if (user) location.href = user.role === "admin" ? "/admin" : "/cabinet";
}).catch(() => {});
