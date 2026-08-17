-- Run this SQL in phpMyAdmin to set up the database

CREATE DATABASE IF NOT EXISTS neuromagic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE neuromagic;

CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255),
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    avatar VARCHAR(255),
    preferred_lang VARCHAR(10) DEFAULT 'en',
    user_role VARCHAR(50),
    reset_token VARCHAR(255),
    reset_token_expires DATETIME,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    original_input TEXT NOT NULL,
    enhanced_result TEXT NOT NULL,
    creation_type VARCHAR(50),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS favorites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    content TEXT NOT NULL,
    title VARCHAR(255),
    category VARCHAR(50),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscriptions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL UNIQUE,
    plan_code VARCHAR(50) NOT NULL DEFAULT 'free',
    status VARCHAR(50) NOT NULL DEFAULT 'inactive',
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    stripe_price_id VARCHAR(255),
    current_period_end DATETIME NULL,
    cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscription_notifications (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    subscription_id VARCHAR(255) NULL,
    notification_type VARCHAR(50) NOT NULL,
    period_end DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_subscription_notice (user_id, subscription_id, notification_type, period_end),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO users (name, email, password, preferred_lang, user_role, created_at)
VALUES
    ('freeuser', 'freeuser@gmail.com', '$2b$12$cHqCf2O1SuATkh/IEcFiQ.RNFwKBq1gK9Yp/M7YhMZVois9vEriKm', 'en', 'General', NOW()),
    ('prouser', 'prouser@gmial.com', '$2b$12$ol4XADOEijz5.CPlYQ8aguOc2xRSqArExUMjFlQlUeSjGxv0Z1Ria', 'en', 'General', NOW()),
    ('plususer', 'plususer@gmail.com', '$2b$12$vbbFfi9gCsHbENfCJ1woO.IXbe3a3fEVocprMyUoFrw3iy/RBQxgW', 'en', 'General', NOW())
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    password = VALUES(password),
    preferred_lang = VALUES(preferred_lang),
    user_role = VALUES(user_role);

INSERT INTO subscriptions (
    user_id, plan_code, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, cancel_at_period_end
)
SELECT
    u.id,
    CASE
        WHEN u.email = 'prouser@gmial.com' THEN 'pro'
        WHEN u.email = 'plususer@gmail.com' THEN 'plus'
        ELSE 'free'
    END AS plan_code,
    CASE
        WHEN u.email = 'freeuser@gmail.com' THEN 'inactive'
        ELSE 'active'
    END AS status,
    NULL,
    CONCAT('local-sub-', u.id),
    NULL,
    CASE
        WHEN u.email IN ('prouser@gmial.com', 'plususer@gmail.com') THEN DATE_ADD(NOW(), INTERVAL 1 MONTH)
        ELSE NULL
    END AS current_period_end,
    0
FROM users u
WHERE u.email IN ('freeuser@gmail.com', 'prouser@gmial.com', 'plususer@gmail.com')
ON DUPLICATE KEY UPDATE
    plan_code = VALUES(plan_code),
    status = VALUES(status),
    current_period_end = VALUES(current_period_end),
    cancel_at_period_end = VALUES(cancel_at_period_end);
