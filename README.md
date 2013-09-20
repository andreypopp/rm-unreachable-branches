# rm-unreachable-branches

Browserify transform to remove unreachable branches in javascript code. By
default it configured to take into account a `__DEV__` variable defined to
`false` but you can configure new transform with any pre-defined variable
bindings as you like.

Code for this transform extracted from one of `esmangle` passes, so all credits
goes to [@constellation][1].

[1]: https://github.com/constellation
