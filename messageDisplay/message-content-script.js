async function showSummaryPane() {
    // Check if auto-summary is enabled in user preferences
    const result = await browser.storage.sync.get('auto_summary_enabled');

    // If auto-summary is disabled or not set, don't show anything
    if (!result.auto_summary_enabled) {
        return;
    }

    // Create the summary pane element
    const summaryPane = document.createElement("div");
    summaryPane.className = "thunderai-summary-pane";

    // Create the title element
    const summaryTitle = document.createElement("div");
    summaryTitle.className = "thunderai-summary-title";
    summaryTitle.innerText = browser.i18n.getMessage("auto_summary_title");

    // Create a loading indicator
    const loadingIndicator = document.createElement("div");
    loadingIndicator.className = "thunderai-summary-content";
    loadingIndicator.innerText = browser.i18n.getMessage("auto_summary_generating");

    // Create the content element (initially hidden)
    const summaryContent = document.createElement("div");
    summaryContent.className = "thunderai-summary-content";
    summaryContent.style.display = 'none';

    // Add title and loading indicator to the pane
    summaryPane.appendChild(summaryTitle);
    summaryPane.appendChild(loadingIndicator);
    summaryPane.appendChild(summaryContent);

    // Insert it as the very first element in the message
    document.body.insertBefore(summaryPane, document.body.firstChild);

    // Get the message content and generate summary
    try {
        const messageContent = getMessageContent();
        const aiSummary = await generateAISummary(messageContent);

        // Update the UI with the AI summary
        loadingIndicator.style.display = 'none';
        summaryContent.innerText = aiSummary;
        summaryContent.style.display = 'block';
    } catch (error) {
        console.error("Error generating AI summary:", error);
        loadingIndicator.innerText = browser.i18n.getMessage("auto_summary_failed");
        loadingIndicator.style.color = '#d70022';

    }
}

function getMessageContent() {
    // Get the main message content from the page
    // This selects the main message body content
    const messageBody = document.querySelector('.moz-text-flowed, .moz-text-plain, body');
    if (messageBody) {
        return messageBody.textContent || messageBody.innerText || '';
    }

    // Fallback: get the entire body content
    return document.body.textContent || document.body.innerText || '';
}

function truncateMessageContent(content) {
    // Clean up the content by removing excessive whitespace and newlines
    const cleanedContent = content.replace(/\s+/g, ' ').trim();

    // Truncate to a reasonable length for preview
    const maxLength = 500;
    if (cleanedContent.length <= maxLength) {
        return cleanedContent;
    }

    return cleanedContent.substring(0, maxLength) + '...';
}

async function generateAISummary(messageContent) {
    // Clean up the message content
    const cleanedContent = messageContent.replace(/\s+/g, ' ').trim();

    // Create a simple summary prompt using localized string
    const summaryPrompt = browser.i18n.getMessage("auto_summary_prompt") + cleanedContent;

    // Request AI summary from the background script
    return new Promise((resolve, reject) => {
        // Send message to background script to get AI summary
        browser.runtime.sendMessage({
            command: "generate_summary",
            content: cleanedContent,
            prompt: summaryPrompt
        }, (response) => {
            if (response && response.summary) {
                resolve(response.summary);
            } else if (response && response.error) {
                // Use the localized error message
                reject(new Error(browser.i18n.getMessage("auto_summary_failed")));
            } else {
                reject(new Error(browser.i18n.getMessage("auto_summary_failed")));
            }
        });
    });
}

// Call the function to show the pane
showSummaryPane();