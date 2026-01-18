const cors = require('cors');

const corsOptions = {
    origin: (origin, callback) => {
        // Commented out - too verbose for production logs
        // console.log(`[CORS Origin Check] Request origin: ${origin}`);
        const allowedOrigins = [
            'https://iannouvel.github.io',
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:5500',
            'https://clerkyai.health',
            'https://www.clerkyai.health',
            'http://localhost:5000',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:5000'
        ];
        if (!origin || allowedOrigins.includes(origin)) {
            // console.log(`[CORS Origin Check] Origin allowed: ${origin || '(no origin - server-to-server or direct)'}`);
            callback(null, true);
        } else {
            console.error(`[CORS Origin Check] Origin blocked: ${origin}`);
            callback(new Error('Not allowed by CORS policy for this server'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
    credentials: true,
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204
};

module.exports = corsOptions;
