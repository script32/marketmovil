FROM mhart/alpine-node:8

ENV NODE_VERSION 8.9.4

RUN apk add --no-cache make gcc g++ python bash

WORKDIR /var/supermercado

COPY lib/ /var/supermercado/lib/
COPY bin/ /var/supermercado/bin/
COPY config/ /var/supermercado/config/
COPY public/ /var/supermercado/public/
COPY routes/ /var/supermercado/routes/
COPY views/ /var/supermercado/views/

COPY app.js /var/supermercado/
COPY package.json /var/supermercado/
COPY gulpfile.js /var/supermercado/

RUN npm install

VOLUME /var/supermercado/data

EXPOSE 1111
ENTRYPOINT ["npm", "start"]
