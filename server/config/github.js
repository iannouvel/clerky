require('dotenv').config();

const GITHUB_CONFIG = {
    owner: 'iannouvel',
    repo: 'clerky',
    branch: 'main',
    folder: 'guidance',
    token: process.env.GITHUB_TOKEN
};

module.exports = GITHUB_CONFIG;
