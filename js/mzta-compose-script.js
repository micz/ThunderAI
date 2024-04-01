// Modified version derived from https://github.com/ali-raheem/Aify/blob/13ff87583bc520fb80f555ab90a90c5c9df797a7/plugin/content_scripts/compose.js

const makeParagraphs = (text, func) => {
  const chunks = text.split(/\n{2,}/);
  if (chunks.length == 1) {
    return func(document.createTextNode(text));
  }
  const paragraphs = chunks.map((t) => {
    const p = document.createElement("p");
    p.innerText = t;
    return p;
  });
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    func(paragraphs[i]);
  }
};


const insert = function (text) {
  const prefix = window.document.body.getElementsByClassName("moz-cite-prefix");
  if (prefix.length > 0) {
    const divider = prefix[0];
    let sibling = divider.previousSibling;
    while (sibling) {
      window.document.body.removeChild(sibling);
      sibling = divider.previousSibling;
    }
  }
  return makeParagraphs(text, function (p) {
    window.document.body.insertBefore(p, window.document.body.firstChild);
  });
}


browser.runtime.onMessage.addListener((message) => {
switch (message.command) {
  case "getSelectedText":
    return Promise.resolve(window.getSelection().toString());

  case "replaceSelectedText":
    const selectedText = window.getSelection().toString();
    if (selectedText === '') {
      return insert(message.text);
    }
    const sel = window.getSelection();
    if (!sel || sel.type !== "Range" || !sel.rangeCount) {
      return;
    }
    const r = sel.getRangeAt(0);
    r.deleteContents();
    makeParagraphs(message.text, function (p) {
      r.insertNode(p);
    });
    break;

  case "getText":
    let t = '';
    const children = window.document.body.childNodes;
    for (const node of children) {
      if (node instanceof Element) {
        if (node.classList.contains('moz-signature')) {
          continue;
        }
      }
      t += node.textContent;
    }
    return Promise.resolve(t);

  case "getTextOnly":
      return Promise.resolve(window.document.body.innerText);

  default:
    // do nothing
    break;
}    
});