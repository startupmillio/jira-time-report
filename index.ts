import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { parse } from 'csv-parse';

void (async () => {
  const filepath = process.argv[2];

  assert(filepath, "Usage: 'npm start -- <filepath>'");

  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf-8")) as Config;
  const file = fs.readFileSync(filepath);
  const csv = await readCSV(file);
  const tasks = parseCSV(csv, config);
  const aggregated = aggregate(tasks);
  const html = toHTML(aggregated);

  console.log(html);
})();

function readCSV(file: Buffer): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const parser = parse();
    const records: string[][] = [];
  
    parser.on('readable', function(){
      let record;
      while ((record = parser.read()) !== null) {
        records.push(record);
      }
    });
    
    
    parser.on('error', function(err) {
      reject(err);
    });
    
    parser.on('end', function() {
      resolve(records);
    });
    
    parser.write(file);
    parser.end();
  });
}

function parseCSV(records: string[][], config: Config): Task[] {
  const [header, ...rows] = records;
  const summaryIndex = 0;
  const logWorkIndexes = [...header.entries()].filter(([index, column]) => column === "Log Work").map(([index, column]) => index);
  const tasks: any[] = [];

  for (const row of rows) {
    const summary = row[summaryIndex];
    const workLogs: any[] = [];

    for (const index of logWorkIndexes) {
      const logWork = row[index];

      if (logWork) {
        const [_, dateString, userId, timeInMinutes] = logWork.split(";");
        const user = config.users.find((u) => u.id === userId);

        assert(user, `Cannot find user with id ${userId} in config.js`);

        const date = new Date(dateString);

        if (!config.workLogs.filter.from || date > new Date(config.workLogs.filter.from)) {
          workLogs.push({
            date,
            user,
            spent: {
              minutes: Number(timeInMinutes)
            },
          })
        }

      }
    }

    tasks.push({
      task: summary,
      workLogs,
    });
  }

  return tasks;
}

function aggregate(tasks: Task[]) {
  const result: Aggregated = {
    tasks: [],
    total: [],
  };
  let users = tasks.flatMap((task) => task.workLogs).map((log) => log.user);
  
  users = [
    ...new Set(users.map((user) => user.id))
  ]
    .map((id) => users.find((user) => user.id === id)!)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const task of tasks) {
    result.tasks.push({
      task: task.task,
      users: users.map((user) => ({
        user,
        spent: {
          seconds: task.workLogs
            .filter((log) => log.user.id === user.id)
            .map((log) => log.spent.minutes)
            .reduce((acc, x) => acc + x, 0),
        },
      })),
      total: {
        spent: {
          seconds: task.workLogs.map((log) => log.spent.minutes).reduce((acc, x) => acc + x, 0)
        }
      }
    });
  }

  result.tasks = result.tasks.filter((task) => task.users.some((user) => user.spent.seconds > 0));
  result.tasks.sort((t1, t2) => t2.total.spent.seconds - t1.total.spent.seconds)

  for (const user of users) {
    result.total.push({
      user,
      spent: {
        seconds: tasks
          .flatMap((task) => task.workLogs)
          .filter((log) => log.user.id === user.id)
          .map((log) => log.spent.minutes)
          .reduce((acc, x) => acc + x, 0)
      }
    })
  }

  return result;
}

function toHTML(aggregated: Aggregated): string {
  return `
    <html>
      <body>
        <table>
          <tbody>
            <tr>
              <th style="width: 300px"><b>Task</b></th>
              ${aggregated.total.map((user) => `<th><b>${user.user.name}</b></th>`).join("\n")}
            </tr>
            ${aggregated.tasks.map((task) => `
              <tr>
                <td>${task.task}</td>
                ${task.users.map((user) => `<td>${user.spent.seconds > 0 ? formatTimeSpent(user.spent) : ""}</td>`).join("\n")}
              </tr>
            `).join("\n")}
            <tr>
              <td><b>Total</b></td>
              ${aggregated.total.map((user) => `<td><b>${formatTimeSpent(user.spent)}</b></td>`).join("\n")}
            </tr>
          </tbody>
        </table>
        <style>
          table, th, td {
            font-family: -apple-system;
            border: 1px solid;
            border-spacing: 0;
            padding: 0 0.25rem;
            vertical-align: top;
          }

          table {
            padding: 0;
          }
        </style>
      </body>
    <html>
  `
}

function formatTimeSpent(spent: {seconds: number}): string {
  const minutes = spent.seconds / 60;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 8);

  return days > 0 ? `${days}d ${hours % 8}h ${minutes % 60}m` : `${hours}h ${minutes % 60}m`
}

interface Config {
  workLogs: {
    filter: {
      from?: string;
    }
  };
  users: {
    id: string;
    name: string;
  }[];
}

interface Task {
  task: string;
  workLogs: {
    "date": Date;
    "user": {
      "id": string;
      "name": string
    };
    "spent": {
      "minutes": number
    };
  }[];
}

interface Aggregated {
  tasks: {
    task: string;
    users: {
      user: {
        id: string;
        name: string;
      };
      spent: {
        seconds: number;
      };
    }[];
    total: {
      spent: {
        seconds: number;
      }
    }
  }[];

  total: {
    user: {
      id: string;
      name: string;
    };
    spent: {
      seconds: number;
    };
  }[];
}
