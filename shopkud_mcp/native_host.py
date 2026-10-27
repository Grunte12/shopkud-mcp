#!/usr/bin/python3
"""Chrome native messaging relay. No CLI executor, Tincan, LLM or network host."""
import argparse
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import sys
import threading

MAX=512000


def default_config_path():
    value=os.environ.get("LOCALAPPDATA")
    if not value: raise ValueError("configuration_invalid")
    return Path(value).expanduser().absolute()/"ShopKud MCP"/"config.json"


def _owned(info):
    return os.name=="nt" or info.st_uid==os.getuid()


def _private_mode(info,mode):
    return os.name=="nt" or stat.S_IMODE(info.st_mode)==mode


def _unaliased(path,info):
    if os.name=="nt":
        return getattr(info,"st_file_attributes",0)&getattr(stat,"FILE_ATTRIBUTE_REPARSE_POINT",0x400)==0
    return path.resolve()==path


def read_frame(stream):
    header=stream.read(4)
    if not header: return None
    while len(header)<4:
        chunk=stream.read(4-len(header))
        if not chunk: raise ValueError("invalid_frame")
        header+=chunk
    size=struct.unpack("=I",header)[0]
    if not 1 <= size <= MAX: raise ValueError("invalid_frame")
    data=bytearray()
    while len(data)<size:
        chunk=stream.read(size-len(data))
        if not chunk: raise ValueError("invalid_frame")
        data.extend(chunk)
    value=json.loads(data)
    if not isinstance(value,dict): raise ValueError("invalid_frame")
    return value


def write_frame(stream,value):
    body=json.dumps(value,separators=(",",":")).encode()
    if len(body)>MAX: raise ValueError("invalid_frame")
    pending=memoryview(struct.pack("=I",len(body))+body)
    while pending:
        written=stream.write(pending)
        if not written: raise ValueError("invalid_frame")
        pending=pending[written:]
    stream.flush()


def run(config_path,origin):
    path=Path(config_path)
    info=path.lstat(); directory=path.parent.lstat()
    if (not _unaliased(path,info) or not _unaliased(path.parent,directory)
            or not stat.S_ISREG(info.st_mode) or not _private_mode(info,0o600)
            or not _owned(info) or info.st_nlink!=1 or info.st_size>8192
            or not stat.S_ISDIR(directory.st_mode) or not _private_mode(directory,0o700)
            or not _owned(directory)):
        raise ValueError("configuration_invalid")
    config=json.loads(path.read_text())
    if origin not in config["allowed_origins"]: raise ValueError("origin_rejected")
    if "native_port" in config:
        if (type(config.get("native_port")) is not int or not 1024<=config["native_port"]<=65535
                or type(config.get("native_token")) is not str
                or not re.fullmatch(r"[0-9a-f]{64}",config["native_token"])):
            raise ValueError("configuration_invalid")
        connection=socket.create_connection(("127.0.0.1",config["native_port"]),timeout=5)
        hello={"type":"hello","origin":origin,"token":config["native_token"]}
    else:
        sock_path=Path(config["socket_path"])
        if sock_path.parent!=path.parent or sock_path.name!="native.sock": raise ValueError("configuration_invalid")
        info=sock_path.lstat()
        if not stat.S_ISSOCK(info.st_mode) or not _owned(info) or not _private_mode(info,0o600):
            raise ValueError("connection_unavailable")
        connection=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        connection.settimeout(5); connection.connect(str(sock_path))
        hello={"type":"hello","origin":origin}
    with connection:
        channel=connection.makefile("rwb",buffering=0)
        write_frame(channel,hello)
        ack=read_frame(channel)
        if ack!={"type":"hello-ack"}: raise ValueError("connection_unavailable")
        connection.settimeout(None)
        write_frame(sys.stdout.buffer,ack)
        def forward_chrome():
            try:
                while True:
                    message=read_frame(sys.stdin.buffer)
                    if message is None:return
                    write_frame(channel,message)
            except (OSError,ValueError,TypeError):
                pass
            finally:
                try:connection.shutdown(socket.SHUT_WR)
                except OSError:pass
        threading.Thread(target=forward_chrome,daemon=True).start()
        while True:
            message=read_frame(channel)
            if message is None:return
            write_frame(sys.stdout.buffer,message)


def parse_args(argv=None):
    parser=argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config")
    parser.add_argument("--parent-window")
    parser.add_argument("origin")
    return parser.parse_args(argv)


def main():
    if os.name=="nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
    args=parse_args()
    try: run(args.config or default_config_path(),args.origin)
    except (OSError,ValueError,KeyError,TypeError):
        # Fixed diagnostic only; never stdout noise, private paths or tokens.
        write_frame(sys.stdout.buffer,{"type":"bridge-error","error":"native_connection_unavailable"})


if __name__=="__main__": main()
