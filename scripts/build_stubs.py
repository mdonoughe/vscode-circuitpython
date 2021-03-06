import appdirs
import subprocess
import os
#import mypy
import pathlib
import re
import glob
import json

# This is a script for using circuitpython's repo to make pyi files for each board type.
# These need to be bundled with the extension, which means that adding new boards is still
# a new release of the extension.

# First thing we want to do is store in memory, the contents of 
# ./circuitpython/circuitpython-stubs/board/__init__.py so we can append it to
# every other board.
board_stub = pathlib.Path(os.path.join("./stubs/board", "__init__.pyi"))

# See [Issue #26](https://github.com/joedevivo/vscode-circuitpython/issues/26) 
# for more on this.
generic_stubs = {}
with open(board_stub) as stub:
  stubs = stub.readlines()
  i = 0
  f = []
  for s in stubs:
    if s.startswith('def'):
      f.append(i)
    i += 1
  f.append(i)

  x = f.pop(0)
  for y in f:
    it = '  ' + ''.join(stubs[x:y-1])
    r = re.search(r'def ([^\(]*)\(', it)
    k = r[1]
    generic_stubs[k] = it
    x = y

# now, while we build the actual board stubs, replace any line that starts with `  $name:` with value

board_dirs = glob.glob("circuitpython/ports/*/boards/*")
boards = []
for b in board_dirs :
  site_path = os.path.split(b)[-1]

  config = pathlib.Path(os.path.join(b, "mpconfigboard.mk"))
  print(config)
  pins   = pathlib.Path(os.path.join(b, "pins.c"))
  if config.is_file() and pins.is_file():

    usb_vid = ""
    usb_pid = ""
    usb_product = ""
    usb_manufacturer = ""
    with open(config) as conf:
      for line in conf:
        if line.startswith("USB_VID"):
          usb_vid = line.split("=")[1].split("#")[0].strip('" \n')
        elif line.startswith("USB_PID"):
          usb_pid = line.split("=")[1].split("#")[0].strip('" \n')
        elif line.startswith("USB_PRODUCT"):
          usb_product = line.split("=")[1].split("#")[0].strip('" \n')
        elif line.startswith("USB_MANUFACTURER"):
          usb_manufacturer = line.split("=")[1].split("#")[0].strip('" \n')
    if usb_manufacturer == "Nadda-Reel Company LLC":
      continue

    board = { 'vid': usb_vid, 'pid': usb_pid, 'product': usb_product, 'manufacturer': usb_manufacturer, 'site_path': site_path }
    boards.append(board)
    print("{0}:{1} {2}, {3}".format(usb_vid, usb_pid, usb_manufacturer, usb_product))
    board_pyi_path = pathlib.Path(os.path.join("boards", usb_vid, usb_pid))
    board_pyi_path.mkdir(parents=True, exist_ok=True)
    board_pyi_file = pathlib.Path(os.path.join(board_pyi_path, "board.pyi"))

    # Indent 0 char for the first pin, 2 for the rest
    indent = ""

    # We're going to put the common stuff from the generic board stub at the 
    # end of the file, so we'll collect them after the loop
    board_stubs = {}

    with open(board_pyi_file, 'w') as outfile, open(pins) as p:
      outfile.write("from typing import Any\n")
      outfile.write('"""\n')
      outfile.write('board {0} {1}\n'.format(board['manufacturer'], board['product']))
      outfile.write('https://circuitpython.org/boards/{0}\n'.format(board['site_path']))
      outfile.write('"""\n')
      outfile.write("  board.")
      for line in p:
        pin = re.search(r'.*_QSTR\(MP_QSTR_([^\)]*)', line)
        if pin == None: 
          continue
        pin_name = pin[1]
        if pin_name in generic_stubs:
          board_stubs[pin_name] = generic_stubs[pin_name]
          continue
        else:
          outfile.write("{0}{1}: Any = ...\n".format(indent, pin_name))
          #redefine indent every time
          indent = "  "
      # End for
      for p in board_stubs:
        outfile.write("{0}\n".format(board_stubs[p]))
    
json_file = pathlib.Path(os.path.join("boards", "metadata.json"))
with open(json_file, 'w') as metadata:
  json.dump(boards, metadata)
