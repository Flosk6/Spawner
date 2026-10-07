import { describe, expect, it } from 'vitest';
import { dockerfileLayerWarnings } from './dockerfile';

describe('dockerfileLayerWarnings', () => {
  it('accepts dependencies installed before the code is copied', () => {
    const text = ['FROM node:22-alpine', 'WORKDIR /app', 'COPY package.json package-lock.json ./', 'RUN npm ci', 'COPY . .', 'RUN npm run build', 'CMD ["npm", "start"]'].join('\n');
    expect(dockerfileLayerWarnings(text)).toEqual([]);
  });

  it('warns when the whole code is copied before the dependencies are installed', () => {
    const text = ['FROM node:22-alpine', 'WORKDIR /app', 'COPY . .', 'RUN npm ci', 'CMD ["npm", "start"]'].join('\n');
    expect(dockerfileLayerWarnings(text)).toMatchObject([{ copyLine: 3, installLine: 4 }]);
  });

  it('reads options, continuation lines and other package managers', () => {
    const text = [
      '# PHP',
      'FROM composer:2 AS vendor',
      'COPY --chown=www-data:www-data . /var/www',
      'RUN apt-get update && \\',
      '    composer install --no-dev',
      'FROM python:3.13-slim',
      'COPY requirements.txt .',
      'RUN pip install -r requirements.txt',
      'COPY . .',
    ].join('\n');
    expect(dockerfileLayerWarnings(text)).toMatchObject([{ copyLine: 3, installLine: 4 }]);
  });

  it('looks at each stage alone, and ignores copies from another stage', () => {
    const text = [
      'FROM node:22-alpine AS deps',
      'COPY package.json pnpm-lock.yaml ./',
      'RUN pnpm install --frozen-lockfile',
      'FROM node:22-alpine',
      'COPY --from=deps /node_modules ./node_modules',
      'COPY . .',
      'RUN yarn build',
    ].join('\n');
    expect(dockerfileLayerWarnings(text)).toEqual([]);
  });

  it('warns once per stage', () => {
    const text = ['FROM node:22', 'COPY . .', 'RUN npm ci', 'RUN npm install left-pad', 'FROM ruby:3', 'ADD . /srv', 'RUN bundle install'].join('\n');
    expect(dockerfileLayerWarnings(text).map((warning) => warning.copyLine)).toEqual([2, 6]);
  });
});
