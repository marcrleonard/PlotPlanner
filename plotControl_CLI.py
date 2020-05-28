import click

import os

#python3 plotControl_CLI.py plot /Users/marcleonard/Projects/p5/marc_circles.svg


from python.plotter import PlotControl

pc = PlotControl(interactive=True)


@click.group('cli')
def cli():
    """Manages CLI."""


@cli.command('plot')
@click.argument('file')
def plotcommand(file=None):
    """/path/to/file.svg"""

    if not os.path.exists(file):
        click.echo('Files does not exist. Provide full path.')
    else:
        click.echo('path to plot {}'.format(file))

        pc.run(filename=file)


@cli.group('setup')
def setup():
    """Run Setup commands"""


@setup.command('connection')
def connection():
    """(will return the status of the plotter connection)"""

    connection = pc.connection()

    if connection['connected'] == False:
        rv = 'No plotter found :-('
    else:
        rv = 'Connection found:\n{}'.format(connection)

    click.echo(rv)


if __name__ == '__main__':

    cli()
