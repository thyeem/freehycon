#!/usr/bin/perl 

my $target = 'blockdb rawblock worldstate minedDBsql peerdbsql txDBsql';

if ($ARGV[0] eq '--remote') {
    for (split / /, $target) {
        system("/usr/bin/scp -r -i ~/.hycon.pem ubuntu\@node1.freehycon.com:~/freehycon/$_ $ARGV[1]");
    }
} else {
    system("/bin/cp -afv $target $ARGV[0]");
}

