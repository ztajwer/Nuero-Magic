-- NeuroMagic Database Migration Script
-- Use this in PHPMyAdmin to set up your database

CREATE DATABASE IF NOT EXISTS `neuromagic` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `neuromagic`;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(255),
    `email` VARCHAR(255) NOT NULL UNIQUE,
    `password` VARCHAR(255) NOT NULL,
    `avatar` VARCHAR(255),
    `preferred_lang` VARCHAR(10) DEFAULT 'en',
    `user_role` VARCHAR(50),
    `reset_token` VARCHAR(255),
    `reset_token_expires` DATETIME,
    `last_login` DATETIME,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. History Table (Renamed columns for new terminology)
CREATE TABLE IF NOT EXISTS `history` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT UNSIGNED NOT NULL,
    `original_input` TEXT NOT NULL,
    `enhanced_result` TEXT NOT NULL,
    `creation_type` VARCHAR(50),
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_history_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Favorites Table
CREATE TABLE IF NOT EXISTS `favorites` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT UNSIGNED NOT NULL,
    `content` TEXT NOT NULL,
    `title` VARCHAR(255),
    `category` VARCHAR(50),
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_favorites_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add demo user (optional, password is 'password123' hashed)
-- INSERT INTO `users` (`name`, `email`, `password`) VALUES ('Demo User', 'demo@neuromagic.com', '$2b$10$wN9p.y/SgqR2GvXv5zG9O.fN0s4kS0/pA8v5jXhBfO.m.XqA8G9K');
