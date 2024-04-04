export function getLanguageDisplayName(languageCode) {
    const languageDisplay = new Intl.DisplayNames([languageCode], {type: 'language'});
    let lang_string = languageDisplay.of(languageCode);
    return lang_string.charAt(0).toUpperCase() + lang_string.slice(1);
  }