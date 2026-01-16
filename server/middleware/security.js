const cors = require('cors');
const helmet = require('helmet');

const configureSecurity = (app) => {
    // Configure CORS to allow requests from the frontend
    app.use(cors({
        origin: [
            'https://clerkyai.health',
            'https://www.clerkyai.health',
            'http://localhost:3000',
            'http://localhost:5000',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:5000'
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // Configure helmet with proper Firebase exceptions
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                connectSrc: [
                    "'self'",
                    "https://*.googleapis.com",
                    "https://*.gstatic.com",
                    "https://identitytoolkit.googleapis.com",
                    "https://securetoken.googleapis.com",
                    "https://*.firebaseio.com",
                    "https://*.cloudfunctions.net"
                ],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://*.googleapis.com", "https://*.gstatic.com"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https:", "blob:"],
                fontSrc: ["'self'", "data:", "https:"],
                frameSrc: ["'self'", "https://*.firebaseapp.com"]
            }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" }
    }));
};

module.exports = {
    configureSecurity
};
