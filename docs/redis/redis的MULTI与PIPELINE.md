## 1. 问题

redis的multi相信很多同学用过，先看下面的代码。



```php
<?php
$redis = new Redis();
$host = "10.136.30.144";
$port = "7777";

$redis->connect($host, $port);
$multi = $redis->multi();
for ($i=0; $i<5; $i++){
    $multi->incr("x");
}

$res = $redis->exec();
var_dump($res);
```

代码对x执行了5次incr操作，输出结果也很容易理解



```csharp
array(5) {
  [0]=>
  int(1)
  [1]=>
  int(2)
  [2]=>
  int(3)
  [3]=>
  int(4)
  [4]=>
  int(5)
}
```

问题来了

1. 这5次incr命令是一起发给redis的么？
2. 服务端是一次返回所有结果还是分5次返回？
3. 整个过程客户端除了发送incr命令外是否还发送了其它命令？

如果你对上面几个问题的答案不是很确定，那么不妨继续往下读。

## 2. 回答

要解答上面的问题，最方便的办法是~抓个包。
 在客户端机器上执行

`tcpdump port 7777 -n -s 1024 -i eth0 -w multi.dump`
 结果如下：

![](https://xiangzaixiansheng.oss-cn-beijing.aliyuncs.com/github_xiangzai/redis_mulit1.png)

整个过程一共有22个tcp包，耗时0.013s其中：



```undefined
- 4包向服务端发MULTI指令 
- 6包服务端回复OK 
- 8包向服务端发送INCR 
- 9包服务端返回QUEUED 
- 10-17包内容与8-9一样，是循环执行的过程 
- 18包向服务端发送EXEC 
- 19包返回执行结果
```

现在我们可以回答上面的问题了

1. 5次incr命令是单独发给服务端的，每发送服务端都要回复QUEUED
2. 服务端将执行结果打包一次返回给了客户端
3. 除了INCR，客户端还额外发送了MULTI和EXEC指令。

## 3. 对比

如果使用普通方式，串行执行5个INCR会怎么样呢？
 我们将代码调整为



```php
<?php
$redis = new Redis();
$host = "10.136.30.144";
$port = "7777";

$redis->connect($host, $port);

for ($i=0; $i<5; $i++){
    $res = $redis->incr("x");
    var_dump($res);
}
```

重新抓包，结果如下：

![](https://xiangzaixiansheng.oss-cn-beijing.aliyuncs.com/github_xiangzai/redis_mulit2.png)



18个数据包，0.0076s完成，比MULTI方式略少。

## 4. 如何更高效

有没有方法将所有想执行的命令一次打包发给redis服务端，使得整个执行过程更高效呢（节省网络交互时间）？答案是肯定的。
 multi有个可选参数，默认值是使用Redis::MULTI。将参数值设为Redis::PIPELINE即可解决问题。
 将上1中的代码改动一行。

`$multi = $redis->multi(Redis::PIPELINE);`
 重新抓包，结果如下：

![](https://xiangzaixiansheng.oss-cn-beijing.aliyuncs.com/github_xiangzai/redis_mulit3.png)
 整个过程一共有10个tcp包，其中：

```undefined
- 4包向服务端打包发送所有INCR指令 
- 6包返回执行结果
```

再对比下执行时间，由于PIPELINE方式网络交互少，从抓包图上看，整个过程只要0.0036s，只有2中的MULTI方式（0.013s）的28%！，2中普通串行方式（0.076s）的47%。

## 5. 更进一步

PIPE方式，对打包的命令条数有限制么？
 我们将上面的循环次数改为500次，也就是将500条INCR一下发给redis，也可以正常运行。唯一不同的是，受限于TCP包大小，500条INCR被拆成了2个数据包发给redis服务端，服务端返回的数据也同样由于包大小的限制，被拆成了3个数据包。所以，可以认为PIPE对打包命令的条数没有限制。

## 6.如何选择

Redis::MULTI方式会将命令逐条发给redis服务端。只有在需要使用事物时才选择Redis::MULTI方式，它可以保证发给redis的一系列命令以原子方式执行。但效率相应也是最低的。
 Redis::PIPELINE方式，可以将一系列命令打包发给redis服务端。如果只是为了一下执行多条redis命令，无需事物和原子性，那么应该选用Redis::PIPELINE方式。代码的性能会有大幅度提升！