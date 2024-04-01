function saveOptions(e) {
  e.preventDefault();
  let options = {};
  document.querySelectorAll(".option-input").forEach(element => {
    options[element.id] = element.checked;
  });
  browser.storage.sync.set(options);
}

function restoreOptions() {
  function setCurrentChoice(result) {
    document.querySelectorAll(".option-input").forEach(element => {
      element.checked = result[element.id] || false;
    });
  }

  function onError(error) {
    console.log(`Error: ${error}`);
  }

  let getting = browser.storage.sync.get(null);
  getting.then(setCurrentChoice, onError);
}

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
  i18n.updateDocument();
  document.querySelectorAll(".option-input").forEach(element => {
    element.addEventListener("change", saveOptions);
  });
}, { once: true });
