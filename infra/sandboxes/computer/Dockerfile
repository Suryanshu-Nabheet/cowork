FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    xterm \
    xdotool \
    x11-utils \
    x11-xserver-utils \
    novnc \
    websockify \
    python3 \
    ca-certificates \
    procps \
    bash \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    dbus-x11 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /etc/cowork/fluxbox \
  && printf '%s\n' '#!/bin/sh' 'exec xsetroot -solid "#111113" "$@"' > /usr/bin/fbsetbg \
  && chmod +x /usr/bin/fbsetbg \
  && ln -sfn /bin/true /usr/bin/xmessage
ENV DISPLAY=:1
ENV HOME=/home/cowork
WORKDIR /home/cowork
COPY start.sh /usr/local/bin/cowork-computer
COPY cowork-browser /usr/local/bin/cowork-browser
COPY fluxbox.init /etc/cowork/fluxbox/init
COPY fluxbox.apps /etc/cowork/fluxbox/apps
COPY fluxbox.menu /etc/cowork/fluxbox/menu
COPY embed.html /usr/share/novnc/embed.html
RUN chmod +x /usr/local/bin/cowork-computer /usr/local/bin/cowork-browser
EXPOSE 6080
CMD ["/usr/local/bin/cowork-computer"]
