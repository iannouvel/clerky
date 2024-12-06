guidelines.forEach(guideline => {
    const listItem = document.createElement('li');
    const link = document.createElement('a');
    
    // Convert the .txt filename to .pdf and construct the raw GitHub URL
    const pdfFilename = guideline.replace(/\.txt$/, '.pdf');
    link.href = `https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/${pdfFilename}`;
    
    // Clean up the display name (remove extension and clean up)
    const displayName = guideline.replace(/\.txt$/, "");
    link.textContent = ` ${displayName}`;
    link.target = '_blank';
    
    listItem.appendChild(link);
    guidelinesUl.appendChild(listItem);
});

