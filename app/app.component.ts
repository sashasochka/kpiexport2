import 'rxjs/Rx';
import {Component} from 'angular2/core';
import {Http, Headers, HTTP_PROVIDERS} from 'angular2/http';
import {RouteConfig, ROUTER_DIRECTIVES} from 'angular2/router';

declare const moment: (...args: any[]) => any;

interface Course {
  lesson_week: string;
  day_number: string;
  lesson_name: string;
  lesson_room: string;
  lesson_type: string;
  teacher_name: string;
  time_start: string;
  time_end: string;
}

interface Group {
  group_id: number;
  group_full_name: string;
}

@Component({
  selector: 'app',
  templateUrl: 'app/app.component.html',
  styleUrls: ['app/app.component.css'],
  directives: [ROUTER_DIRECTIVES],
  providers: [HTTP_PROVIDERS]
})
export class App {
  get groupName() { return localStorage.getItem('groupName') || '' }
  set groupName(groupName) { localStorage.setItem('groupName', groupName); }

  get calendarName() { return localStorage.getItem('calendarName') || 'KPI Schedule' }
  set calendarName(calendarName) { localStorage.setItem('calendarName', calendarName); }

  googleAccessToken: string = undefined

  groups: Object = {};

  status = {
    success: true,
    importing: false,
    coursesTotal: 0,
    coursesLoaded: 0,
    msg: ''
  }

  objectKeys = Object.keys;

  constructor(public http: Http) {
    http.get('//api.rozklad.org.ua/v2/groups/?filter={"showAll":true}')
      .map(res => res.json())
      .subscribe(res => {
        // create a map of group names and ids (some groups can have same names, so we store ids in array)
        let ids = {};
        res.data.forEach((group: Group) => {
          if (group.group_full_name in ids) {
            ids[group.group_full_name].push(group.group_id);
          } else {
            ids[group.group_full_name] = [group.group_id];
          }
        });

        Object.keys(ids).forEach(groupName => {
          if (ids[groupName].length === 1) {
            this.groups[groupName] = ids[groupName][0];
          } else {
            // append group id to group name if there are multiple groups with this name
            ids[groupName].forEach((groupID: number) => {
              let newName = `${groupName} [${groupID}]`;
              this.groups[newName] = groupID;
            });
          }
        });
      });
  }

  createCalendarEvent(course: Course) {
    const isSecondSemester: boolean = moment().month() < 6;
    const firstStudyMonth = !isSecondSemester ? 8 : 1; // september vs february
    let firstStudyDay = !isSecondSemester ? 1: moment([moment().year(), firstStudyMonth, 1, 0, 0]).day(8).date();
    if (moment().year() === 2016 && isSecondSemester) {
      firstStudyDay = 15;
    }
    const date = moment([moment().year(), firstStudyMonth, firstStudyDay, 0, 0]).day(course.day_number);

    // shift the date of first course day by a week for second-week schedule
    if (course.lesson_week === '2') {
        date.add(7, 'day');
    }

    // date.day() can move the date backwards. If it did move the date to august - fix it back to september.
    if (date.date() > 14 && !isSecondSemester) {
        date.add(14, 'day');
    }

    const daystr = date.format('DD');

    return {
      summary: course.lesson_name,
      description: `${course.lesson_name} (${course.lesson_type})\nВикладач: ${course.teacher_name}`,
      start: {
        dateTime: `${moment().year()}${isSecondSemester ? '-02-' : '-09-'}${daystr}T${course.time_start}`,
        timeZone: 'Europe/Kiev'
      },
      end: {
        dateTime: `${moment().year()}${isSecondSemester ? '-02-' : '-09-'}${daystr}T${course.time_end}`,
        timeZone: 'Europe/Kiev'
      },
      recurrence: [
        `RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=${moment().year()}${isSecondSemester ? '0610' : '1231'}T235959Z`
      ],
      location: `НТУУ "КПІ" (${course.lesson_room})`
    };
  }

  getGoogleTokenPromise() {
    if (this.googleAccessToken) {
      return Promise.resolve(this.googleAccessToken);
    }

    return new Promise((resolve, reject) => {
      const tab = window.open(
        'https://accounts.google.com/o/oauth2/v2/auth?' +
        'scope=https://www.googleapis.com/auth/calendar&' +
        'response_type=token&' +
        'client_id=107429331396-ju6s4ssmt3tjo2ndpoli34turtkod612.apps.googleusercontent.com&' +
        `redirect_uri=${document.location.protocol}//${document.location.host}/authsuccess`,
        "Authentication", "height=1000,width=1000,modal=yes,alwaysRaised=yes");

      const timer = setInterval(() => {
        const successMatches = /^#access_token=(.*)&token_type/.exec(tab.document.location.hash);
        if (successMatches) {
          this.googleAccessToken = successMatches[1]; // async or promise
          tab.close();
          clearInterval(timer);
          resolve(this.googleAccessToken);
        } else if (tab.document.location.hash === '#error=access_denied') {
          tab.close();
          reject('You have to allow access to your Google profile to use this app.');
        }
      }, 100);
    });
  }

  import() {
    this.status.importing = true;
    this.getGoogleTokenPromise().then(token => {
      this.http.get(`//api.rozklad.org.ua/v2/groups/${this.groups[this.groupName]}/lessons`)
        .map(res => res.json())
        .subscribe(response => {
          const courses: Course[] = response.data;

          this.status.coursesTotal = courses.length;

          this.status.msg = 'Creating calendar';
          this.status.success = true;

          const contentTypeJSONHeader = new Headers();
          contentTypeJSONHeader.append('Content-Type', 'application/json');

          const calendar = {
              summary: this.calendarName,
              location: 'NTUU KPI, Kyiv, Ukraine'
          };
          this.http.post(`https://www.googleapis.com/calendar/v3/calendars/?access_token=${token}`,
              JSON.stringify(calendar),
              {headers: contentTypeJSONHeader})
            .map(res => res.json())
            .subscribe((calendar) => {
              const ps = courses.map(course => {
                return this.http.post(
                    `https://www.googleapis.com/calendar/v3/calendars/${calendar.id}/events?access_token=${token}`,
                    JSON.stringify(this.createCalendarEvent(course)),
                    {headers: contentTypeJSONHeader})
                  .retry(5);
              });

              let loaded = 0;
              let errors = 0;

              const updateStatus = () => {
                this.status.coursesLoaded = loaded + errors;
                this.status.success = errors === 0;

                if (loaded + errors !== ps.length) {
                  this.status.msg = `creating schedule: ${loaded}/${ps.length}`;
                  if (errors) {
                    this.status.msg += `errors - ${errors}`;
                  }
                } else if (loaded === ps.length) {
                  this.status.importing = false;
                  this.status.msg = 'completed!';
                } else {
                  this.status.msg = 'error while creating the calendar!';
                }
              }

              for (let p of ps) {
                p.subscribe(() => {
                  ++loaded;
                  updateStatus();
                }, () => {
                  ++errors;
                  updateStatus();
                });
              }
            }, err => {
              this.status.importing = false;
              this.status.msg = 'error while creating the calendar!';
              this.status.success = false;
            });
      }, err => {
        this.status.importing = false;
        if (err.status === 404) {
          this.status.msg = 'group doesn\'t exist!';
        } else {
          this.status.msg = 'error while accessing API at https://rozklad.org.ua!';
        }
        this.status.success = false;
      });
    }, alert);
  }
}
