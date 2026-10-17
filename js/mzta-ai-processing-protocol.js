// Content-only API shared by the background broker and extension-page client.
export const AI_PROCESSOR_ID = 'thunderai-privacy@micz.it';
export const AI_PROCESSING_PROTOCOL = 1;

export function processingError(code) {
    const error = new Error(browser.i18n.getMessage(code) || code);
    error.code = code;
    return error;
}
