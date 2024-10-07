async function handleAction() {
    const summaryText = summaryTextarea.value.trim();
    if (summaryText === '') {
        alert('Please enter a summary text first.');
        return;
    }

    actionSpinner.style.display = 'inline-block';
    actionText.style.display = 'none';

    try {
        console.log('Starting handleAction...');
        console.log('Summary text:', summaryText);

        const issuesPrompt = `${promptIssues.value.trim()}\n\nClinical Text: ${summaryText}`;
        console.log('Issues prompt:', issuesPrompt);

        const issuesResponse = await getAIResponse({ prompt: issuesPrompt });
        console.log('Issues response:', issuesResponse);

        const issuesList = issuesResponse.response
            .split('\n')
            .map(issue => issue.trim())
            .filter(issue => issue);

        console.log('Parsed issues list:', issuesList);

        suggestedGuidelinesDiv.innerHTML = '';
        for (const issue of issuesList) {
            console.log('Processing issue:', issue);

            const issueDiv = document.createElement('div');
            issueDiv.className = 'accordion-item';

            const issueTitle = document.createElement('h4');
            issueTitle.className = 'accordion-header';
            issueTitle.textContent = issue;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'accordion-content';
            contentDiv.style.display = 'none';

            const guidelinesUl = document.createElement('ul');

            // Fetch the guidelines for the current issue
            const guidelines = await getGuidelinesForIssue(issue);
            console.log('Fetched guidelines for issue:', issue, guidelines);

            if (guidelines.length === 0) {
                console.warn('No guidelines found for issue:', issue);
            }

            for (const guideline of guidelines) {
                const guidelineLi = document.createElement('li');
                const link = document.createElement('a');
                let encodedGuideline = encodeURIComponent(guideline.trim() + '.pdf');
                let url = `https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/${encodedGuideline}`;
                if (url.endsWith('.pdf.pdf')) {
                    url = url.slice(0, -4);
                }

                link.href = url;
                link.textContent = guideline.replace(/\.pdf$/i, '').replace(/_/g, ' ');
                link.target = '_blank';

                const algoLink = document.createElement('a');
                const htmlFilename = guideline.replace(/\.pdf$/i, '.html');
                const algoUrl = `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;
                algoLink.href = algoUrl;
                algoLink.textContent = 'Algo';
                algoLink.target = '_blank';
                algoLink.style.marginLeft = '10px';

                guidelineLi.appendChild(link);
                guidelineLi.appendChild(algoLink);
                guidelinesUl.appendChild(guidelineLi);
            }

            contentDiv.appendChild(guidelinesUl);
            issueDiv.appendChild(issueTitle);
            issueDiv.appendChild(contentDiv);
            suggestedGuidelinesDiv.appendChild(issueDiv);

            issueTitle.addEventListener('click', () => {
                const isVisible = contentDiv.style.display === 'block';
                contentDiv.style.display = isVisible ? 'none' : 'block';
                issueTitle.classList.toggle('active', !isVisible);
            });
        }
    } catch (error) {
        console.error('Error handling action:', error);
        alert('An error occurred while processing the action.');
    } finally {
        actionSpinner.style.display = 'none';
        actionText.style.display = 'inline';
    }
}
