FROM rocker/shiny:3.5.2
# R 3.5.2 + Shiny Server 1.5.11 on Debian stretch, which is archived: point apt at archive.debian.org
RUN printf 'deb http://archive.debian.org/debian stretch main\n' > /etc/apt/sources.list \
 && rm -f /etc/apt/sources.list.d/* \
 && apt-get -o Acquire::Check-Valid-Until=false update -qq \
 && apt-get install -y --allow-unauthenticated -qq libcurl4-openssl-dev libssl-dev libxml2-dev \
 && rm -rf /var/lib/apt/lists/*
# exact package versions of the 2020 deployment (packrat.lock), installed twice (see reinstall_ordered.R)
COPY packrat.lock /tmp/packrat.lock
COPY install_lock.R /tmp/install_lock.R
RUN Rscript /tmp/install_lock.R
COPY reinstall_ordered.R /tmp/reinstall_ordered.R
RUN Rscript /tmp/reinstall_ordered.R
RUN rm -rf /srv/shiny-server/*
COPY shiny-server.conf /etc/shiny-server/shiny-server.conf
COPY app/ /srv/shiny-server/grouptherapy/
# Shiny Server serves an R Markdown document (runtime: shiny) in an app_dir when it is called index.Rmd.
# The app directory stays owned by root and read-only for the "shiny" user, so nothing can be written
# next to the Rmd; rmarkdown renders into the R session's tempdir and uploads also go to tempdir.
RUN ln -s GroupTherapyPatientAllocationWebApp.Rmd /srv/shiny-server/grouptherapy/index.Rmd \
 && chmod -R a+rX,go-w /srv/shiny-server/grouptherapy
# Security patch applied at build time (shiny/app/ in the repo stays the original): the 'Available spots'
# check is anchored, so only "name = integer" pairs reach eval(parse()); valid input behaves exactly as before.
RUN sed -i 's|grepl("\\\\w+\\\\s\*=\\\\s\*\\\\d", strsplit|grepl("^\\\\s*\\\\w+\\\\s*=\\\\s*\\\\d+\\\\s*$", strsplit|' /srv/shiny-server/grouptherapy/GroupTherapyPatientAllocationWebApp.Rmd \
 && grep -q 'grepl("^' /srv/shiny-server/grouptherapy/GroupTherapyPatientAllocationWebApp.Rmd
