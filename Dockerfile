FROM php:8.4-fpm-alpine AS base

RUN apk add --no-cache \
    linux-headers \
    $PHPIZE_DEPS \
    icu-dev \
    mysql-client \
    git \
    unzip \
    curl \
    && docker-php-ext-install pdo_mysql intl pcntl opcache bcmath \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del $PHPIZE_DEPS

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

COPY php/opcache.ini /usr/local/etc/php/conf.d/opcache.ini
COPY php/php.ini /usr/local/etc/php/conf.d/custom.ini

FROM base AS development
EXPOSE 9000
CMD ["php-fpm"]

FROM base AS production
COPY . .
RUN composer install --no-dev --optimize-autoloader --no-interaction \
    && php artisan config:cache \
    && php artisan route:cache \
    && php artisan view:cache \
    && chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache
EXPOSE 9000
CMD ["php-fpm"]
