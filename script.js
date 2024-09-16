function loadGuidelines() {
    // Clear the guidelines list before populating it
    guidelinesList.innerHTML = '';

    // Fetch the list_of_guidelines.txt file from the repository
    fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/list_of_guidelines.txt')
        .then(response => response.text())
        .then(data => {
            const guidelines = data.split('\n').filter(line => line.trim() !== ''); // Split the file by lines and filter empty ones
            guidelines.forEach(guideline => {
                const listItem = document.createElement('li');
                
                // Create the link for the PDF in the guidance folder
                const link = document.createElement('a');
                const formattedGuideline = guideline.trim();
                link.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${formattedGuideline}`;
                link.textContent = formattedGuideline;
                link.target = '_blank'; // Open in new tab

                // Create the Algo link
                const algoLink = document.createElement('a');
                // Replace .pdf with .html for the algo link
                const htmlFilename = formattedGuideline.replace(/\.pdf$/i, '.html');
                const algoUrl = `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;
                
                // Set Algo link properties
                algoLink.href = algoUrl;
                algoLink.textContent = 'Algo';
                algoLink.target = '_blank';
                algoLink.style.marginLeft = '10px'; // Add some space between the links

                // Append both the guideline PDF link and the algo link to the list item
                listItem.appendChild(link);
                listItem.appendChild(algoLink);

                // Append the list item to the guidelines list
                guidelinesList.appendChild(listItem);

                // Log for debugging
                console.log(`Added guideline link: ${link.href}`);
                console.log(`Added algo link: ${algoLink.href}`);
            });
        })
        .catch(error => console.error('Error loading guidelines:', error));
}
