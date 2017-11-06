import './bootstrap';

import $ from 'jquery';
import { Artisan } from './commands/artisan';
import { Composer } from './commands/composer';
import { Help } from './commands/help';
import { Loading } from './loading';
import { MySQL } from './commands/mysql';
import { Tinker } from './commands/tinker';
import { Vi } from './commands/vi';
import outputFormatter from './output-formatter';

function addslashes(str) {
    return String(str)
        .replace(/[\\"']/g, '\\$&')
        .replace(/\u0000/g, '\\0');
}

export class Terminal {
    constructor(element, options) {
        this.element = document.querySelector(element);
        this.options = options;
        this.requestId = 0;
        this.formatter = outputFormatter;
        this.prompt = '$ ';

        this.fit();

        this.shell = $(this.element).terminal(this.handle.bind(this), {
            onClear: this.serverInfo.bind(this),
            onPop: () => {
                this.prompt = '$ ';
            },
            prompt: this.prompt,
            greetings: this.greetings(),
        });

        this.commands = [
            new Help(this, options),
            new Artisan(this, options),
            new Tinker(this, options),
            new MySQL(this, options),
            new Composer(this, options),
            new Vi(this, options),
        ];

        this.handle('help');

        this.spinner = new Loading({
            stream: this,
        });

        window.addEventListener('resize', this.fit.bind(this));
    }

    async handle(str) {
        str = str.trim();
        for (const interpreter in this.options.interpreters) {
            if (str === interpreter) {
                const prompt = this.options.interpreters[interpreter];
                this.interpreter(prompt);

                return;
            }
        }

        const cmd = $.terminal.parse_command(str);
        for (let i = 0; i < this.commands.length; i++) {
            const command = this.commands[i];
            if (command.is(cmd.name) === true) {
                command.handle(
                    cmd.args.map((arg, i) => {
                        const quote = cmd.args_quotes[i];

                        return addslashes(`${quote}${arg}${quote}`);
                    })
                );

                return;
            }
        }

        try {
            const response = await this.sendRequest(str);
            this.line(response);
            this.serverInfo();
        } catch (error) {
            this.error(error.message);
            this.serverInfo();
        }
    }

    write(str, setPrompt = false) {
        if (setPrompt === true) {
            this.shell.set_prompt(str);
        } else {
            this.echo(str);
        }
    }

    showCursor() {
        this.element.querySelector('.cursor').style.display = '';
        this.shell.set_prompt(this.prompt);
        this.shell.enable();
    }

    hideCursor() {
        this.element.querySelector('.cursor').style.display = 'none';
        this.shell.disable();
    }

    clearLine() {}

    cursorTo(pos) {}

    environment() {
        return this.options.environment;
    }

    isProduction() {
        return this.environment() === 'production';
    }

    confirmToProceed(command) {
        return this.options.confirmToProceed[command] ? this.options.confirmToProceed[command] : [];
    }

    sendRequest(command, parameters = []) {
        return new Promise((resolve, reject) => {
            $.ajax({
                url: this.options.endpoint,
                dataType: 'json',
                type: 'post',
                data: {
                    jsonrpc: '2.0',
                    id: ++this.requestId,
                    command,
                    parameters,
                },
                beforeSend: jqXHR => {
                    jqXHR.setRequestHeader('X-CSRF-TOKEN', this.options.csrfToken);
                    this.spinner.start('');
                },
                success: response => {
                    const responseResult = response.result ? response.result : response.error;
                    resolve(responseResult ? responseResult : response);
                },
                error: (jqXHR, textStatus, errorThrown) => {
                    reject(new Error(`${jqXHR.status}: ${errorThrown}`));
                },
                complete: () => {
                    this.spinner.stop();
                },
            });
        });
    }

    greetings() {
        return `
 __                        _    _____              _         _
|  |   ___ ___ ___ _ _ ___| |  |_   ____ ___ _____|_|___ ___| |
|  |__| .'|  _| .'| | | -_| |    | || -_|  _|     | |   | .'| |
|_____|__,|_| |__,|\\_/|___|_|    |_||___|_| |_|_|_|_|_|_|__,|_|

Copyright (c) 2015 Recca Tsai <https://github.com/recca0120/>

Type a command, or type \`${this.style('help', 'info')}\`, for a list of commands.`;
    }

    interpreter(prompt) {
        this.prompt = `${prompt}> `;
        this.shell.push(
            str => {
                this.handle(`${prompt.replace(/\s+/g, '-')} ${str}`);
            },
            {
                prompt: this.prompt,
            }
        );
    }

    fit() {
        const parent = this.element.parentNode;
        if (parent.tagName === 'BODY') {
            this.element.style.width = `${window.innerWidth}px`;
            this.element.style.height = `${window.innerHeight}px`;
        } else {
            this.element.style.width = `${parent.offsetWidth - 20}px`;
            this.element.style.height = `${parent.offsetHeight - 20}px`;
        }
    }

    serverInfo() {
        if (this.shell.level() > 1) {
            return;
        }

        const host = this.style(`${this.options.username}@${this.options.hostname}`, 'info');
        const os = this.style(this.options.os, 'question');
        const path = this.style(this.options.basePath, 'comment');
        this.echo(`${host} ${os} ${path}`);
    }

    pause() {
        this.shell.pause();
    }

    resume() {
        this.shell.resume();
    }

    focus() {
        this.shell.focus();
    }

    scrollToBottom() {
        this.shell.scroll_to_bottom();
    }

    style(text, style = '') {
        return this.formatter[style](text);
    }

    echo(text) {
        this.shell.echo(text);
    }

    line(text) {
        if (!text) {
            this.shell.echo(' ');

            return;
        }
        const regex = new RegExp(
            '(\\033\\[(\\d+)(;\\d+)?m(((?!\\033\\[\\d+).)*)\\033\\[(\\d+)(;\\d+)?m)|(\\[|\\])',
            'g'
        );
        let content;
        text = text.replace(regex, (...m) => {
            if (['[', ']'].includes(m[0]) === true) {
                return $.terminal.escape_brackets(m[0]);
            }
            content = $.terminal.escape_brackets(m[4]);
            if (m[2] === '32') {
                return this.style(content, 'info');
            }

            if (m[2] === '33') {
                return this.style(content, 'comment');
            }

            if (m[2] === '37') {
                return this.style(content, 'error');
            }

            return m[0];
        });

        text.split('\n').forEach(line => {
            if (line === '') {
                line = ' ';
            }
            this.shell.echo(line);
        });
    }

    error(text) {
        this.shell.error(text);
    }

    ask(message, title = '') {
        return new Promise((resolve, reject) => {
            const history = this.shell.history();
            history.disable();

            if (title !== '') {
                this.echo(title);
            }

            this.echo(message);
            this.scrollToBottom();
            this.shell.push(
                result => {
                    if (['y', 'yes', 'true'].includes(result.toLowerCase())) {
                        resolve(true);
                    } else {
                        resolve(false);
                        this.serverInfo();
                    }
                    this.shell.pop();
                    this.scrollToBottom();
                    history.enable();
                },
                {
                    prompt: ' > ',
                }
            );
        });
    }
}

window.Terminal = Terminal;
