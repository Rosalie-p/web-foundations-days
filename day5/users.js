const API_URL = "https://jsonplaceholder.typicode.com/users";

const loadButton = document.getElementById("load-users");
const filterInput = document.getElementById("filter-input");
const statusEl = document.getElementById("status");
const usersList = document.getElementById("users-list");

// Stores the loaded users so filtering never needs a new request
let allUsers = [];

async function loadUsers() {
  statusEl.textContent = "Loading users...";
  loadButton.disabled = true;

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error("Request failed with status " + response.status);
    }

    allUsers = await response.json();
    renderUsers(allUsers);
    statusEl.textContent = "Loaded " + allUsers.length + " users.";
  } catch (error) {
    allUsers = [];
    usersList.textContent = "";
    statusEl.textContent = "Error: could not load users. " + error.message;
  } finally {
    loadButton.disabled = false;
  }
}

function renderUsers(list) {
  usersList.textContent = "";

  if (list.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No users match your filter.";
    usersList.appendChild(li);
    return;
  }

  list.forEach(function (user) {
    const li = document.createElement("li");

    const name = document.createElement("strong");
    name.textContent = user.name;

    const email = document.createElement("div");
    email.textContent = "Email: " + user.email;

    const city = document.createElement("div");
    city.textContent = "City: " + user.address.city;

    const company = document.createElement("div");
    company.textContent = "Company: " + user.company.name;

    li.append(name, email, city, company);
    usersList.appendChild(li);
  });
}

function filterUsers() {
  // Nothing loaded yet, so nothing to filter
  if (allUsers.length === 0) {
    return;
  }

  const text = filterInput.value.trim().toLowerCase();
  const filtered = allUsers.filter(function (user) {
    return user.name.toLowerCase().includes(text);
  });

  renderUsers(filtered);
}

loadButton.addEventListener("click", loadUsers);
filterInput.addEventListener("input", filterUsers);